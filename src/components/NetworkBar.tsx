import { useSwitchChain } from 'wagmi'
import { useAccount } from '@/hooks/useAccount'
import { AlertTriangle } from 'lucide-react'
import { CHAIN_ID } from '@/lib/vault'
import { NETWORK_NAME } from '@/lib/network'

export function WrongNetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  if (!isConnected || chainId === CHAIN_ID) return null
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(240,180,41,0.16)', border: '1px solid rgba(148,98,0,0.3)' }}>
      <span className="flex items-center gap-2 font-medium" style={{ color: 'var(--warn)' }}>
        <AlertTriangle className="size-4" /> Your wallet is on a different network. Nodra runs on {NETWORK_NAME}.
      </span>
      <button className="btn btn-primary btn-sm" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
        {isPending ? 'Switching...' : `Switch to ${NETWORK_NAME}`}
      </button>
    </div>
  )
}
