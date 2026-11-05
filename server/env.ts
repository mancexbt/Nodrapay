import { readFileSync } from 'node:fs'
import type { Address } from 'viem'

/** Reads KEY=value pairs from an env file without touching process.env. */
function readEnvFile(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
    return out
  } catch {
    return {}
  }
}

const testnet = readEnvFile('.env.testnet')

/** Email wallets and alerts run on Arc Testnet only, so they always use the testnet vault. */
export const VAULT_ADDRESS = (process.env.WALLETS_VAULT_ADDRESS ?? testnet.VITE_PAYOUT_VAULT_ADDRESS ?? '') as Address
export const BLOCKCHAIN = process.env.CIRCLE_BLOCKCHAIN ?? 'ARC-TESTNET'
export const CIRCLE_BASE_URL = process.env.CIRCLE_BASE_URL ?? 'https://api.circle.com'
/** Hosts such as Hugging Face Spaces set PORT; locally the API listens on API_PORT (8787). */
export const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787)
const keyName = ['CIRCLE_API_KEY', 'CIRCLE_DEVELOPER_CONTROLLED_API_KEY', 'CIRCLE_SCP_API_KEY'].find((k) => process.env[k])
export const CIRCLE_API_KEY = keyName ? process.env[keyName] : undefined
export const PUBLIC_URL = process.env.ALERTS_PUBLIC_URL
export const SMTP = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM ?? 'Nodra <no-reply@nodra.app>',
}
export const ALERTS_DRY_RUN = process.env.ALERTS_DRY_RUN === '1'
export const ALERTS_ENABLED = Boolean(SMTP.host) || ALERTS_DRY_RUN
