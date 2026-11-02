import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import nodemailer from 'nodemailer'
import { createPublicClient, http, isAddress, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { payoutVaultAbi } from '../src/contracts/payoutVault'
import { ApiError, validEmail } from './circle'
import { ALERTS_DRY_RUN, ALERTS_ENABLED, SMTP, VAULT_ADDRESS } from './env'

interface Sub {
  id: string
  email: string
  address: Address
  token: string
  confirmed: boolean
  createdAt: number
  notified: string[]
}
interface Store {
  subs: Sub[]
  lastBlock: string | null
}

const DIR = '.data'
const FILE = `${DIR}/alerts.json`
const CLAIM_GRACE = 7n * 86400n
const ARBITER_GRACE = 7n * 86400n
const DISPUTE_WINDOW = 30n * 86400n

function load(): Store {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Store
  } catch {
    return { subs: [], lastBlock: null }
  }
}
function save(store: Store) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, FILE)
}

const transport = SMTP.host
  ? nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined })
  : null

async function sendMail(to: string, subject: string, text: string) {
  if (transport) {
    await transport.sendMail({ from: SMTP.from, to, subject, text })
  } else if (ALERTS_DRY_RUN) {
    console.log(`[alerts:dry-run] to=${to} subject="${subject}"\n${text}\n`)
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function subscribe(emailRaw: unknown, addressRaw: unknown, baseUrl: string) {
  if (!ALERTS_ENABLED) throw new ApiError(503, 'Email alerts are not set up on this server.')
  if (!validEmail(emailRaw)) throw new ApiError(400, 'Enter a valid email address.')
  if (typeof addressRaw !== 'string' || !isAddress(addressRaw)) throw new ApiError(400, 'Enter a valid wallet address.')
  const email = emailRaw.trim().toLowerCase()
  const address = addressRaw.toLowerCase() as Address
  const store = load()
  let sub = store.subs.find((s) => s.email === email && s.address === address)
  if (sub?.confirmed) return { status: 'already' as const }
  if (!sub) {
    sub = { id: crypto.randomUUID(), email, address, token: randomToken(), confirmed: false, createdAt: Date.now(), notified: [] }
    store.subs.push(sub)
    save(store)
  }
  await sendMail(
    email,
    'Confirm your Nodra alerts',
    `Confirm that you want Nodra alerts for the wallet ${address}:\n\n${baseUrl}/api/alerts/confirm?token=${sub.token}\n\nIf this wasn't you, ignore this email and nothing will be sent.`,
  )
  return { status: 'pending' as const }
}

export function confirm(token: string): boolean {
  const store = load()
  const sub = store.subs.find((s) => s.token === token)
  if (!sub) return false
  sub.confirmed = true
  save(store)
  return true
}

export function unsubscribe(token: string): boolean {
  const store = load()
  const next = store.subs.filter((s) => s.token !== token)
  if (next.length === store.subs.length) return false
  save({ ...store, subs: next })
  return true
}

/* ---------- notifier ---------- */

const client = createPublicClient({ chain: arcTestnet, transport: http() })
const scheduleKinds = ['Scheduled payout', 'Payroll', 'Vesting plan', 'Investor lockup', 'Token claim', 'Token grant', 'Treasury lockup', 'Time lock', 'LP lockup']

async function alert(sub: Sub, key: string, subject: string, body: string, baseUrl: string) {
  if (sub.notified.includes(key)) return
  sub.notified.push(key)
  if (sub.notified.length > 500) sub.notified = sub.notified.slice(-500)
  await sendMail(sub.email, subject, `${body}\n\nOpen Nodra to take action.\n\nStop these emails: ${baseUrl}/api/alerts/unsubscribe?token=${sub.token}`)
}

export async function runNotifier(baseUrl: string) {
  if (!ALERTS_ENABLED || !VAULT_ADDRESS) return
  const store = load()
  const confirmed = store.subs.filter((s) => s.confirmed)
  const head = await client.getBlockNumber()
  if (store.lastBlock === null) {
    store.lastBlock = head.toString()
    save(store)
    return
  }
  if (confirmed.length === 0) {
    store.lastBlock = head.toString()
    save(store)
    return
  }

  // 1) New activity since the last run
  let from = BigInt(store.lastBlock) + 1n
  while (from <= head) {
    const to = from + 1999n > head ? head : from + 1999n
    const logs = await client.getContractEvents({ address: VAULT_ADDRESS, abi: payoutVaultAbi, fromBlock: from, toBlock: to })
    for (const log of logs) {
      const k = `${log.transactionHash}-${log.logIndex}`
      if (log.eventName === 'EscrowCreated') {
        const { id, depositor, beneficiary, arbiter, amount } = log.args
        for (const sub of confirmed) {
          const addr = sub.address
          if (addr === beneficiary?.toLowerCase()) await alert(sub, k, `New escrow #${id} for you`, `${depositor} locked funds for you in escrow #${id}.`, baseUrl)
          else if (arbiter && addr === arbiter.toLowerCase()) await alert(sub, k, `You were named arbiter on escrow #${id}`, `${depositor} named you arbiter of escrow #${id} (${amount} raw units).`, baseUrl)
        }
      } else if (log.eventName === 'ScheduleCreated') {
        const { id, funder, beneficiary, kind } = log.args
        for (const sub of confirmed) if (sub.address === beneficiary?.toLowerCase() && sub.address !== funder?.toLowerCase()) await alert(sub, k, `New ${scheduleKinds[Number(kind)] ?? 'plan'} #${id} for you`, `${funder} set up a ${scheduleKinds[Number(kind)] ?? 'plan'} for you.`, baseUrl)
      } else if (log.eventName === 'EscrowDisputed') {
        const id = log.args.id
        if (id === undefined) continue
        const e = await client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'getEscrow', args: [id] })
        const other = log.args.by?.toLowerCase() === e.depositor.toLowerCase() ? e.beneficiary : e.depositor
        for (const sub of confirmed) {
          if (sub.address === other.toLowerCase() || (e.arbiter !== '0x0000000000000000000000000000000000000000' && sub.address === e.arbiter.toLowerCase())) {
            await alert(sub, k, `Dispute raised on escrow #${id}`, `A dispute was raised on escrow #${id}. A dispute pauses the recipient's claim for 30 days; it does not freeze funds.`, baseUrl)
          }
        }
      }
    }
    store.lastBlock = to.toString()
    from = to + 1n
  }

  // 2) Time-based: payments ready to claim, escrow claim windows opening
  const now = BigInt(Math.floor(Date.now() / 1000))
  for (const sub of confirmed) {
    const [scheduleIds, escrowIds] = await Promise.all([
      client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'scheduleIdsOf', args: [sub.address] }),
      client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'escrowIdsOf', args: [sub.address] }),
    ])
    for (const id of scheduleIds.slice(-50)) {
      const s = await client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'getSchedule', args: [id] })
      if (s.beneficiary.toLowerCase() !== sub.address) continue
      const releasable = await client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'releasable', args: [id] })
      if (releasable === 0n) continue
      const periodsDone = s.stepDuration >= 3600n ? (now - s.start) / s.stepDuration : null
      const key = periodsDone !== null ? `ready-${id}-${periodsDone}` : `ready-${id}-${releasable === s.total - s.claimed ? 'all' : 'part'}`
      if (periodsDone === null && releasable !== s.total - s.claimed) continue
      await alert(sub, key, `A payment is ready to claim (#${id})`, `Your ${scheduleKinds[s.kind] ?? 'plan'} #${id} has unlocked tokens you can claim now.`, baseUrl)
    }
    for (const id of escrowIds.slice(-50)) {
      const e = await client.readContract({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'getEscrow', args: [id] })
      if (e.beneficiary.toLowerCase() !== sub.address) continue
      if (e.amount - e.released - e.refunded === 0n) continue
      const opens = BigInt(e.deadline) + CLAIM_GRACE + (e.arbiter === '0x0000000000000000000000000000000000000000' ? 0n : ARBITER_GRACE)
      const blocked = e.disputed && now < BigInt(e.disputedAt) + DISPUTE_WINDOW
      if (now >= opens && !blocked) await alert(sub, `claim-${id}`, `You can claim escrow #${id} now`, `Nobody released or refunded escrow #${id} in time, so you can now claim what is left.`, baseUrl)
    }
  }
  save(store)
}

