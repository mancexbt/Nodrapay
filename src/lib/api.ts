import { useQuery } from '@tanstack/react-query'
import { IS_MAINNET } from '@/lib/network'

/** Base URL of the Nodra API server. Empty in dev, where Vite proxies /api. */
export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')
/** Circle "App ID" from Wallets > User Controlled > Configurator. Public value. */
export const CIRCLE_APP_ID = (import.meta.env.VITE_CIRCLE_APP_ID as string | undefined) || undefined

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiRequestError('Could not reach the Nodra server. Check your connection and try again.', 0)
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: number } & Record<string, unknown>
  if (!res.ok) throw new ApiRequestError(json.error ?? 'Something went wrong.', res.status, json.code)
  return json as T
}

export const circleCall = <T>(action: string, params: Record<string, unknown> = {}) => apiPost<T>('/api/circle', { action, ...params })

export interface ServerConfig {
  emailWallets: boolean
  alerts: boolean
}

export function useServerConfig() {
  return useQuery({
    queryKey: ['server-config'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<ServerConfig> => {
      const res = await fetch(`${API_BASE}/api/config`)
      if (!res.ok) throw new Error('config unavailable')
      return (await res.json()) as ServerConfig
    },
  })
}

/** Email wallets run on Arc Testnet only, and need the server plus a Circle App ID. */
export function useEmailWalletsEnabled(): boolean {
  const { data } = useServerConfig()
  return !IS_MAINNET && Boolean(CIRCLE_APP_ID) && Boolean(data?.emailWallets)
}
