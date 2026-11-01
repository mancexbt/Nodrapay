import { isAddress } from 'viem'

export function toLocalInput(ms: number): string {
  const shifted = new Date(ms - new Date(ms).getTimezoneOffset() * 60000)
  return shifted.toISOString().slice(0, 16)
}

export function parseLocalInput(value: string): bigint | null {
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : BigInt(Math.floor(t / 1000))
}

export function memoBytes(memo: string): number {
  return new TextEncoder().encode(memo).length
}

export const MAX_MEMO_BYTES = 140

export function validAddress(value: string): value is `0x${string}` {
  return isAddress(value.trim(), { strict: false })
}
