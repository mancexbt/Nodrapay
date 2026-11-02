import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { useAccount } from '@/hooks/useAccount'
import { erc20Abi, isAddress, type Address } from 'viem'
import { labelFor, loadTokenLabels } from '@/lib/tokens'
import {
  CHAIN_ID,
  USDC_ADDRESS,
  VAULT_ADDRESS,
  nowSeconds,
  payoutVaultAbi,
  type EscrowStatus,
  type EscrowView,
  type ScheduleView,
} from '@/lib/vault'

const POLL_MS = 8000

export interface VaultData {
  escrows: EscrowView[]
  schedules: ScheduleView[]
}

export function useVaultData(account?: Address) {
  const client = usePublicClient({ chainId: CHAIN_ID })

  return useQuery<VaultData>({
    queryKey: ['vault', account],
    enabled: !!account && !!client,
    refetchInterval: POLL_MS,
    queryFn: async () => {
      if (!client || !account) return { escrows: [], schedules: [] }
      const [escrowIds, scheduleIds] = await Promise.all([
        client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'escrowIdsOf', args: [account] }),
        client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'scheduleIdsOf', args: [account] }),
      ])

      const [rawEscrows, rawSchedules] = await Promise.all([
        Promise.all(
          escrowIds.map(async (id) => {
            const [escrow, status, milestones] = await Promise.all([
              client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'getEscrow', args: [id] }),
              client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'escrowStatus', args: [id] }),
              client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'getMilestones', args: [id] }),
            ])
            return { id, escrow, status, milestones }
          }),
        ),
        Promise.all(
          scheduleIds.map(async (id) => ({
            id,
            schedule: await client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'getSchedule', args: [id] }),
          })),
        ),
      ])
      const labels = await loadTokenLabels(client, [...rawEscrows.map((r) => r.escrow.token), ...rawSchedules.map((r) => r.schedule.token)])
      const escrows = rawEscrows.map(
        ({ id, escrow, status, milestones }): EscrowView => ({
          ...escrow,
          ...labelFor(labels, escrow.token),
          id,
          remaining: escrow.amount - escrow.released - escrow.refunded,
          status: status as EscrowStatus,
          milestones,
        }),
      )
      const schedules = rawSchedules.map(({ id, schedule }): ScheduleView => ({ ...schedule, ...labelFor(labels, schedule.token), id }))

      const byIdDesc = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? 1 : -1)
      return { escrows: escrows.sort(byIdDesc), schedules: schedules.sort(byIdDesc) }
    },
  })
}


export function useUsdcBalance() {
  const { address } = useAccount()
  return useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: POLL_MS },
  })
}

/** Current unix time in seconds, refreshed on an interval so countdowns and vesting tick live. */
export function useNow(intervalMs = 1000): bigint {
  const [now, setNow] = useState(nowSeconds)
  useEffect(() => {
    const timer = setInterval(() => setNow(nowSeconds()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export interface TokenMeta {
  valid: boolean
  loading: boolean
  ok: boolean
  address: Address
  symbol: string
  decimals: number
  balance?: bigint
}

/** Symbol, decimals and the connected wallet's balance for a token address typed into a form. */
export function useTokenMeta(token: string): TokenMeta {
  const { address: me } = useAccount()
  const valid = isAddress(token.trim(), { strict: false })
  const addr = token.trim() as Address
  const query = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: addr, abi: erc20Abi, functionName: 'symbol', chainId: CHAIN_ID },
      { address: addr, abi: erc20Abi, functionName: 'decimals', chainId: CHAIN_ID },
      { address: addr, abi: erc20Abi, functionName: 'balanceOf', args: [me ?? addr], chainId: CHAIN_ID },
    ],
    query: { enabled: valid, refetchInterval: POLL_MS },
  })
  const [symbol, decimals, balance] = query.data ?? []
  const ok = valid && decimals?.status === 'success'
  return {
    valid,
    loading: valid && query.isLoading,
    ok,
    address: addr,
    symbol: symbol?.status === 'success' ? symbol.result : 'TOKEN',
    decimals: decimals?.status === 'success' ? decimals.result : 18,
    balance: me && balance?.status === 'success' ? balance.result : undefined,
  }
}
