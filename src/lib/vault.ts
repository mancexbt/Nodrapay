import type { Address, ContractFunctionReturnType } from 'viem'
import { getUsdc } from '@/onchain-facts'
import { formatUnitsExact, parseUnitsExact, usdcDecimalsFor } from '@/onchain-money'
import type { payoutVaultAbi } from '@/contracts/payoutVault'

export { payoutVaultAbi } from '@/contracts/payoutVault'

import { ARC_CHAIN, NETWORK_NAME } from '@/lib/network'

export const CHAIN_ID = ARC_CHAIN.id
export const VAULT_ADDRESS = import.meta.env.VITE_PAYOUT_VAULT_ADDRESS as Address

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error(`USDC is not registered for ${NETWORK_NAME}`)
export const USDC_ADDRESS = usdcFact.address as Address
const USDC_DECIMALS = usdcDecimalsFor(CHAIN_ID)

export const ARBITER_GRACE_SECONDS = 7n * 86400n
export const CLAIM_GRACE_SECONDS = 7n * 86400n
export const DISPUTE_WINDOW_SECONDS = 30n * 86400n

export type RawEscrow = ContractFunctionReturnType<typeof payoutVaultAbi, 'view', 'getEscrow'>
export type RawSchedule = ContractFunctionReturnType<typeof payoutVaultAbi, 'view', 'getSchedule'>

export type EscrowStatus = 0 | 1 | 2
export interface TokenLabel {
  symbol: string
  decimals: number
}
export type Milestone = ContractFunctionReturnType<typeof payoutVaultAbi, 'view', 'getMilestones'>[number]
export type EscrowView = RawEscrow & TokenLabel & { id: bigint; remaining: bigint; status: EscrowStatus; milestones: readonly Milestone[] }

/** When the recipient may claim what is left: after the depositor's refund window, plus a grace period. */
export function escrowClaimOpensAt(e: { deadline: bigint; arbiter: string }): bigint {
  const hasArbiter = !/^0x0{40}$/i.test(e.arbiter)
  return e.deadline + (hasArbiter ? ARBITER_GRACE_SECONDS : 0n) + CLAIM_GRACE_SECONDS
}
export type ScheduleView = RawSchedule & TokenLabel & { id: bigint }

export type KindId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const KIND_META: Record<KindId, { label: string; plural: string }> = {
  0: { label: 'Scheduled payout', plural: 'Scheduled payouts' },
  1: { label: 'Payroll', plural: 'Payroll' },
  2: { label: 'Vesting plan', plural: 'Vesting plans' },
  3: { label: 'Investor lockup', plural: 'Investor lockups' },
  4: { label: 'Token claim', plural: 'Token claims' },
  5: { label: 'Token grant', plural: 'Token grants' },
  6: { label: 'Treasury lockup', plural: 'Treasury lockups' },
  7: { label: 'Time lock', plural: 'Time locks' },
  8: { label: 'LP lockup', plural: 'LP lockups' },
}

export const ESCROW_STATUS_LABEL: Record<EscrowStatus, string> = {
  0: 'Active',
  1: 'Completed',
  2: 'Refunded',
}

export const DURATION_UNITS = [
  { id: 'minutes', label: 'Minutes', seconds: 60 },
  { id: 'hours', label: 'Hours', seconds: 3600 },
  { id: 'days', label: 'Days', seconds: 86400 },
  { id: 'weeks', label: 'Weeks', seconds: 604800 },
  { id: 'months', label: 'Months (30d)', seconds: 2592000 },
  { id: 'years', label: 'Years', seconds: 31536000 },
] as const
export type DurationUnitId = (typeof DURATION_UNITS)[number]['id']

export function unitSeconds(unit: DurationUnitId): number {
  return DURATION_UNITS.find((u) => u.id === unit)?.seconds ?? 1
}

/** Whole-number duration in seconds, or null when the input is empty or invalid. */
export function durationSeconds(value: string, unit: DurationUnitId): bigint | null {
  if (!/^\d+$/.test(value.trim())) return null
  const n = BigInt(value.trim())
  return n > 0n ? n * BigInt(unitSeconds(unit)) : null
}

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Amount in a token's own decimals, grouped, at least 2 and at most 6 fraction digits. */
export function fmtToken(raw: bigint, decimals: number): string {
  const [whole, fraction = ''] = formatUnitsExact(raw, decimals).split('.')
  const shown = fraction.padEnd(2, '0').slice(0, 6)
  // Never let a real, non-zero amount read as zero.
  if (raw > 0n && whole === '0' && /^0+$/.test(shown)) return '<0.000001'
  return `${group(whole)}.${shown}`
}

export function fmtUsdc(raw: bigint): string {
  return fmtToken(raw, USDC_DECIMALS)
}

/** Positive amount in raw units for a token with `decimals`, or null when the text is not valid. */
export function parseTokenInput(value: string, decimals: number): bigint | null {
  try {
    const raw = parseUnitsExact(value, decimals)
    return raw > 0n ? raw : null
  } catch {
    return null
  }
}

export function parseUsdcInput(value: string): bigint | null {
  return parseTokenInput(value, USDC_DECIMALS)
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function sameAddr(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

export function fmtDateTime(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function fmtSpan(seconds: bigint): string {
  const s = Number(seconds)
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

/** "Every 30 days" style label for a step length. */
export function fmtCadence(seconds: bigint): string {
  const s = Number(seconds)
  for (const unit of [...DURATION_UNITS].reverse()) {
    if (s % unit.seconds === 0) {
      const n = s / unit.seconds
      const name = unit.id === 'months' ? 'month' : unit.id.slice(0, -1)
      return n === 1 ? `every ${name}` : `every ${n} ${unit.id === 'months' ? 'months' : unit.id}`
    }
  }
  return `every ${fmtSpan(seconds)}`
}

/** Mirrors the contract's unlock rule so progress can tick live between reads. */
export interface SchedParams {
  total: bigint
  start: bigint
  cliff: bigint
  stepDuration: bigint
  steps: number
}

export function unlockedByParams(p: SchedParams, now: bigint): bigint {
  if (now < p.start + p.cliff) return 0n
  const elapsed = now - p.start
  const duration = p.stepDuration * BigInt(p.steps)
  if (elapsed >= duration) return p.total
  const done = elapsed / p.stepDuration
  return (p.total * done) / BigInt(p.steps)
}

export function unlockedAt(s: ScheduleView, now: bigint): bigint {
  if (s.cancelled) return s.total
  return unlockedByParams(s, now)
}

export function releasableAt(s: ScheduleView, now: bigint): bigint {
  const u = unlockedAt(s, now)
  return u > s.claimed ? u - s.claimed : 0n
}

export function isContinuous(s: ScheduleView): boolean {
  return s.stepDuration === 1n
}

export function stepsDoneAt(s: ScheduleView, now: bigint): number {
  if (now < s.start + s.cliff) return 0
  const done = (now - s.start) / s.stepDuration
  return Number(done > BigInt(s.steps) ? BigInt(s.steps) : done)
}

export function nextUnlockAt(s: ScheduleView, now: bigint): bigint | null {
  if (s.cancelled || isContinuous(s)) return null
  const end = s.start + s.stepDuration * BigInt(s.steps)
  if (now >= end) return null
  const cliffEnd = s.start + s.cliff
  if (now < cliffEnd) {
    const firstStep = s.start + s.stepDuration
    return cliffEnd >= firstStep ? cliffEnd : firstStep
  }
  return s.start + (((now - s.start) / s.stepDuration) + 1n) * s.stepDuration
}

export function scheduleEnd(s: ScheduleView): bigint {
  return s.start + s.stepDuration * BigInt(s.steps)
}

export type Tone = 'neutral' | 'success' | 'warn' | 'danger'

export function scheduleStatus(s: ScheduleView, now: bigint): { label: string; tone: Tone } {
  if (s.cancelled) return { label: s.claimed >= s.total ? 'Cancelled, paid' : 'Cancelled', tone: 'warn' }
  if (s.claimed >= s.total) return { label: 'Paid out', tone: 'success' }
  if (releasableAt(s, now) > 0n) return { label: 'Ready to claim', tone: 'success' }
  if (now < s.start) return { label: 'Not started', tone: 'neutral' }
  return { label: 'Streaming', tone: 'neutral' }
}

export function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0
  return Number((part * 10000n) / whole) / 100
}

export const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_PAYOUT_VAULT_DEPLOY_BLOCK as string)

export type SortKey = 'newest' | 'oldest' | 'largest'

export function sortBy<T extends { id: bigint }>(items: T[], key: SortKey, amount: (item: T) => bigint): T[] {
  const copy = [...items]
  if (key === 'oldest') return copy.sort((a, b) => (a.id < b.id ? -1 : 1))
  if (key === 'largest') return copy.sort((a, b) => (amount(a) < amount(b) ? 1 : -1))
  return copy.sort((a, b) => (a.id < b.id ? 1 : -1))
}

export function downloadCsv(filename: string, rows: (string | number | bigint)[][]): void {
  const esc = (v: string | number | bigint) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
