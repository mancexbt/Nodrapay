import { useAccount as useWagmiAccount } from 'wagmi'
import type { Address } from 'viem'
import { useSession } from '@/lib/session'
import { CHAIN_ID } from '@/lib/vault'

/**
 * The connected account, whether it is a browser wallet or an email wallet.
 * Email wallets always live on the app's chain.
 */
export function useAccount(): { address: Address | undefined; isConnected: boolean; chainId: number | undefined; isEmail: boolean } {
  const wallet = useWagmiAccount()
  const { session } = useSession()
  if (session) return { address: session.address, isConnected: true, chainId: CHAIN_ID, isEmail: true }
  return { address: wallet.address, isConnected: wallet.isConnected, chainId: wallet.chainId, isEmail: false }
}
