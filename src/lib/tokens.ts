import { erc20Abi, type Address, type PublicClient } from 'viem'
import type { TokenLabel } from '@/lib/vault'

const cache = new Map<string, TokenLabel>()

/** Reads symbol and decimals once per token. Unreadable tokens fall back to a generic label. */
export async function loadTokenLabels(client: PublicClient, tokens: Address[]): Promise<Map<string, TokenLabel>> {
  await Promise.all(
    [...new Set(tokens.map((t) => t.toLowerCase()))]
      .filter((key) => !cache.has(key))
      .map(async (key) => {
        const address = key as Address
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }).catch(() => 'TOKEN'),
          client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
        ])
        cache.set(key, { symbol, decimals })
      }),
  )
  return cache
}

export function labelFor(map: Map<string, TokenLabel>, token: string): TokenLabel {
  return map.get(token.toLowerCase()) ?? { symbol: 'TOKEN', decimals: 18 }
}
