import { useAccount } from '@/hooks/useAccount'
import type { VaultData } from '@/hooks/useVaultData'
import type { PageId } from '@/lib/plans'
import { GetStarted } from '@/components/GettingStarted'
import { About } from '@/components/Landing'

/** The About page: how to get started, what Nodra is, how it works, what it can do and what to know. */
export function AboutPage({ data, loading, balance, onOpen }: { data?: VaultData; loading: boolean; balance?: bigint; onOpen: (page: PageId) => void }) {
  const { isConnected } = useAccount()
  return (
    <div className="space-y-6">
      {!loading && <GetStarted isConnected={isConnected} balance={balance} data={data} onBrowse={() => onOpen('escrow')} />}
      <About onOpen={onOpen} />
      <section className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4" aria-label="Open the app">
        <div>
          <p className="display text-base font-semibold">Ready to try it?</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Escrows, scheduled payouts, payroll, vesting and treasury lockups each have their own list and tools in the app.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => onOpen('escrow')}>
          Open the app
        </button>
      </section>
    </div>
  )
}
