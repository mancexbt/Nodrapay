import { decodeFunctionData, erc20Abi, isAddress, isHex, type Address, type Hex } from 'viem'
import { payoutVaultAbi } from '../src/contracts/payoutVault'
import { BLOCKCHAIN, CIRCLE_API_KEY, CIRCLE_BASE_URL, VAULT_ADDRESS } from './env'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/

export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value)
}

async function circle(path: string, opts: { method?: 'GET' | 'POST'; userToken?: string; body?: unknown } = {}) {
  if (!CIRCLE_API_KEY) throw new ApiError(503, 'Email wallets are not configured on this server.')
  const res = await fetch(`${CIRCLE_BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CIRCLE_API_KEY}`,
      ...(opts.userToken ? { 'X-User-Token': opts.userToken } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as { data?: unknown; code?: number; message?: string }
  if (!res.ok) throw new ApiError(res.status >= 500 ? 502 : res.status, json.message ?? 'Circle request failed.', json.code)
  return json.data
}

const need = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 4096) throw new ApiError(400, `Missing ${name}.`)
  return v
}

/** Vault functions an email wallet may call. Everything else is refused. */
const ALLOWED_VAULT_FUNCTIONS = new Set([
  'createEscrow',
  'releaseEscrow',
  'releaseMilestone',
  'refundEscrow',
  'claimEscrow',
  'dispute',
  'withdrawDispute',
  'createSchedule',
  'createPayrollBatch',
  'extendSchedule',
  'release',
  'releaseTo',
  'cancel',
])

/** Only the vault's own functions, or an ERC-20 approve whose spender is the vault. */
function assertAllowedCall(contractAddress: string, callData: string) {
  if (!isAddress(contractAddress) || !isHex(callData)) throw new ApiError(400, 'Invalid call.')
  if (contractAddress.toLowerCase() === VAULT_ADDRESS.toLowerCase()) {
    try {
      const { functionName } = decodeFunctionData({ abi: payoutVaultAbi, data: callData as Hex })
      if (ALLOWED_VAULT_FUNCTIONS.has(functionName)) return
    } catch {
      /* fall through */
    }
    throw new ApiError(400, 'That vault action is not allowed.')
  }
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: callData as Hex })
    if (decoded.functionName === 'approve' && String(decoded.args[0]).toLowerCase() === VAULT_ADDRESS.toLowerCase()) return
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'Only token approvals for the vault are allowed.')
}

export async function handleCircle(body: Record<string, unknown>): Promise<unknown> {
  switch (body.action) {
    case 'requestEmailOtp': {
      if (!validEmail(body.email)) throw new ApiError(400, 'Enter a valid email address.')
      return circle('/v1/w3s/users/email/token', {
        method: 'POST',
        body: { idempotencyKey: crypto.randomUUID(), deviceId: need(body.deviceId, 'deviceId'), email: body.email },
      })
    }
    case 'initializeUser':
      return circle('/v1/w3s/user/initialize', {
        method: 'POST',
        userToken: need(body.userToken, 'userToken'),
        body: { idempotencyKey: crypto.randomUUID(), accountType: 'SCA', blockchains: [BLOCKCHAIN] },
      })
    case 'listWallets':
      return circle('/v1/w3s/wallets', { userToken: need(body.userToken, 'userToken') })
    case 'getBalance':
      return circle(`/v1/w3s/wallets/${encodeURIComponent(need(body.walletId, 'walletId'))}/balances`, {
        userToken: need(body.userToken, 'userToken'),
      })
    case 'contractExecution': {
      const contractAddress = need(body.contractAddress, 'contractAddress')
      const callData = need(body.callData, 'callData')
      assertAllowedCall(contractAddress, callData)
      return circle('/v1/w3s/user/transactions/contractExecution', {
        method: 'POST',
        userToken: need(body.userToken, 'userToken'),
        body: {
          idempotencyKey: crypto.randomUUID(),
          walletId: need(body.walletId, 'walletId'),
          contractAddress,
          callData,
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        },
      })
    }
    case 'listTransactions':
      return circle(`/v1/w3s/transactions?walletIds=${encodeURIComponent(need(body.walletId, 'walletId'))}&pageSize=10`, {
        userToken: need(body.userToken, 'userToken'),
      })
    default:
      throw new ApiError(400, 'Unknown action.')
  }
}

export type { Address }
