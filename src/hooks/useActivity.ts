import { createContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Address, Hash } from 'viem'
import { CHAIN_ID, DEPLOY_BLOCK, KIND_META, VAULT_ADDRESS, payoutVaultAbi, type KindId } from '@/lib/vault'
import type { VaultData } from '@/hooks/useVaultData'

export type VaultLog = typeof cache.logs[number]

const isEscrowEvent = (name: string) => name.startsWith('Escrow') || name === 'MilestoneReleased'

export interface ActivityItem {
  key: string
  title: string
  amount: bigint
  symbol: string
  decimals: number
  at: bigint
  txHash: Hash
  tone: 'in' | 'out' | 'neutral'
}

const BATCH = 2000n
const MAX_ITEMS = 12

interface Scan {
  lastBlock: bigint
  logs: Awaited<ReturnType<ReturnType<typeof scanner>>>
}

type Client = NonNullable<ReturnType<typeof usePublicClient>>

// Resumable scan: logs are cached per page load so each poll only reads new blocks.
const cache: { lastBlock: bigint; logs: Scan['logs'] } = { lastBlock: DEPLOY_BLOCK - 1n, logs: [] }

// One scan at a time: overlapping polls would otherwise read the same blocks twice and duplicate events.
let inflight: Promise<void> | null = null

function syncLogs(client: Client, head: bigint): Promise<void> {
  if (!inflight) {
    const scan = scanner(client)
    inflight = (async () => {
      let from = cache.lastBlock + 1n
      while (from <= head) {
        const to = from + BATCH - 1n > head ? head : from + BATCH - 1n
        const logs = await scan(from, to)
        cache.logs = [...cache.logs, ...logs]
        cache.lastBlock = to
        from = to + 1n
      }
    })().finally(() => {
      inflight = null
    })
  }
  return inflight
}

function scanner(client: Client) {
  return (from: bigint, to: bigint) => client.getContractEvents({ address: VAULT_ADDRESS, abi: payoutVaultAbi, fromBlock: from, toBlock: to })
}

export function useActivity(account: Address | undefined, data: VaultData | undefined) {
  const client = usePublicClient({ chainId: CHAIN_ID })

  return useQuery({
    queryKey: ['vault-activity', account, data?.escrows.length, data?.schedules.length],
    enabled: !!client && !!account && !!data,
    refetchInterval: 15000,
    queryFn: async () => {
      if (!client || !data) return { items: [] as ActivityItem[], head: 0n, scanned: 0n, logs: [] as VaultLog[] }
      const head = await client.getBlockNumber()
      await syncLogs(client, head)

      const escrowIds = new Set(data.escrows.map((e) => e.id))
      const scheduleIds = new Set(data.schedules.map((s) => s.id))
      const mine = cache.logs.filter((log) => {
        const id = (log.args).id
        if (id === undefined) return false
        return isEscrowEvent(log.eventName) ? escrowIds.has(id) : scheduleIds.has(id)
      })
      // MilestoneReleased always accompanies EscrowReleased, so the feed lists only the latter.
      const recent = mine.filter((l) => l.eventName !== 'MilestoneReleased').slice(-MAX_ITEMS).reverse()

      const blocks = new Map<bigint, bigint>()
      await Promise.all(
        [...new Set(recent.map((l) => l.blockNumber))].map(async (n) => {
          const block = await client.getBlock({ blockNumber: n })
          blocks.set(n, block.timestamp)
        }),
      )

      const escrowById = new Map(data.escrows.map((e) => [e.id, e]))
      const scheduleById = new Map(data.schedules.map((s) => [s.id, s]))
      const items: ActivityItem[] = recent.map((log) => {
        const at = blocks.get(log.blockNumber) ?? 0n
        const id = (log.args).id
        const owner = id === undefined ? undefined : isEscrowEvent(log.eventName) ? escrowById.get(id) : scheduleById.get(id)
        const key = `${log.transactionHash}-${log.logIndex}`
        const base = { key, at, txHash: log.transactionHash, symbol: owner?.symbol ?? 'TOKEN', decimals: owner?.decimals ?? 18 }
        switch (log.eventName) {
          case 'EscrowCreated':
            return { ...base, title: `Escrow #${log.args.id} funded`, amount: log.args.amount ?? 0n, tone: 'out' as const }
          case 'EscrowReleased':
            return { ...base, title: `Released from escrow #${log.args.id}`, amount: log.args.amount ?? 0n, tone: 'neutral' as const }
          case 'EscrowRefunded':
            return { ...base, title: `Refunded from escrow #${log.args.id}`, amount: log.args.amount ?? 0n, tone: 'neutral' as const }
          case 'ScheduleCreated':
            return { ...base, title: `${KIND_META[Number(log.args.kind) as KindId].label} #${log.args.id} created`, amount: log.args.total ?? 0n, tone: 'out' as const }
          case 'ScheduleReleased':
            return { ...base, title: `Payment released from #${log.args.id}`, amount: log.args.amount ?? 0n, tone: 'in' as const }
          case 'ScheduleExtended':
            return { ...base, title: `Payroll #${log.args.id} extended by ${log.args.extraSteps} periods`, amount: log.args.extra ?? 0n, tone: 'out' as const }
          case 'EscrowDisputed':
            return { ...base, title: `Dispute raised on escrow #${log.args.id}`, amount: 0n, tone: 'neutral' as const }
          case 'EscrowDisputeCleared':
            return { ...base, title: `Dispute cleared on escrow #${log.args.id}`, amount: 0n, tone: 'neutral' as const }
          case 'ScheduleCancelled':
            return { ...base, title: `Schedule #${log.args.id} cancelled`, amount: log.args.refunded ?? 0n, tone: 'neutral' as const }
          default:
            return { ...base, title: 'Activity', amount: 0n, tone: 'neutral' as const }
        }
      })
      return { items, head, scanned: cache.lastBlock, logs: mine }
    },
  })
}

export type ActivityData = NonNullable<ReturnType<typeof useActivity>['data']>

/** Lets plan drawers read the same scanned events as the Overview, without scanning twice. */
export const ActivityContext = createContext<ActivityData | undefined>(undefined)

/** Timestamps for a handful of block numbers (cached, one read per block). */
export function useBlockTimes(blocks: bigint[]) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const key = blocks.map(String).join(',')
  return useQuery({
    queryKey: ['block-times', key],
    enabled: !!client && blocks.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const out = new Map<bigint, bigint>()
      await Promise.all(
        blocks.map(async (n) => {
          const block = await client?.getBlock({ blockNumber: n })
          if (block) out.set(n, block.timestamp)
        }),
      )
      return out
    },
  })
}
