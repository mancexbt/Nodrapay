import { Check } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import type { VaultData } from '@/hooks/useVaultData'
import { IS_MAINNET } from '@/lib/network'

/** Three-step start, driven by real wallet and contract state. Hides itself once every step is done. */
export function GetStarted({
  isConnected,
  balance,
  data,
  onCreate,
  onBrowse,
  onEmail,
}: {
  isConnected: boolean
  balance?: bigint
  data?: VaultData
  onCreate: () => void
  onBrowse: () => void
  onEmail?: () => void
}) {
  const hasFunds = isConnected && (balance ?? 0n) > 0n
  const hasPlan = (data?.escrows.length ?? 0) + (data?.schedules.length ?? 0) > 0
  const done = [isConnected, hasFunds, hasPlan]
  if (done.every(Boolean)) return null

  const cards = [
    {
      title: 'Connect',
      body: 'Use your wallet, or sign in with just an email address.',
      actions: isConnected ? null : (
        <div className="flex flex-wrap gap-2">
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button className="btn btn-primary btn-sm" onClick={show}>
                Connect wallet
              </button>
            )}
          </ConnectKitButton.Custom>
          {onEmail && (
            <button className="btn btn-ghost btn-sm" onClick={onEmail}>
              Use email
            </button>
          )}
        </div>
      ),
    },
    {
      title: 'Fund your wallet',
      body: IS_MAINNET ? 'Add USDC on Arc to your wallet. USDC also pays the network fee.' : 'Add a little test USDC. In Arc Studio, use Get test USDC in the sidebar.',
      actions: null,
    },
    {
      title: 'Create your first escrow',
      body: 'Lock funds for someone and release them as work is approved.',
      actions: (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" disabled={!isConnected} onClick={onCreate}>
            Create escrow
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onBrowse}>
            See all options
          </button>
        </div>
      ),
    },
  ]

  return (
    <section id="get-started" className="space-y-3" aria-label="Get started">
      <h2 className="display text-xl font-bold">Get started</h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {cards.map((c, i) => (
          <li key={c.title} className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
                style={done[i] ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--chip)', color: 'var(--ink-2)' }}
              >
                {done[i] ? <Check className="size-3.5" /> : i + 1}
              </span>
              <h3 className="display text-base font-semibold" style={{ color: done[i] ? 'var(--subtle)' : 'var(--ink)' }}>
                {c.title}
              </h3>
            </div>
            <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
              {c.body}
            </p>
            {!done[i] && c.actions && <div className="mt-auto">{c.actions}</div>}
          </li>
        ))}
      </ol>
    </section>
  )
}
