import { useState, type ReactNode } from 'react'
import { Check, Copy, Download, Search } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { EmptyState, Segmented } from '@/components/ui'
import { shortAddr, type SortKey } from '@/lib/vault'
import { useSession } from '@/lib/session'
import { IS_MAINNET } from '@/lib/network'

export type Direction = 'all' | 'in' | 'out'

export function Identity({ address, sub }: { address: string; sub?: ReactNode }) {
  const hue = parseInt(address.slice(2, 6), 16) % 360
  const hue2 = (hue + 70) % 360
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="size-8 shrink-0 rounded-full"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 66%), hsl(${hue2} 55% 52%))` }}
      />
      <div className="min-w-0">
        <p className="mono truncate text-sm font-medium">{shortAddr(address)}</p>
        {sub && (
          <p className="truncate text-xs" style={{ color: 'var(--subtle)' }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  blurb,
  action,
}: {
  title: string
  blurb: string
  action: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-2xl font-bold">{title}</h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--muted)' }}>
          {blurb}
        </p>
      </div>
      {action}
    </div>
  )
}

export function Toolbar({
  direction,
  onDirection,
  query,
  onQuery,
  counts,
  sort,
  onSort,
  onExport,
}: {
  direction: Direction
  onDirection: (d: Direction) => void
  query: string
  onQuery: (q: string) => void
  counts: Record<Direction, number>
  sort: SortKey
  onSort: (s: SortKey) => void
  onExport: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented
        label="Direction"
        value={direction}
        onChange={onDirection}
        options={[
          { id: 'all', label: `All ${counts.all}` },
          { id: 'in', label: `Incoming ${counts.in}` },
          { id: 'out', label: `Outgoing ${counts.out}` },
        ]}
      />
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label className="relative block min-w-0 flex-1 sm:w-56 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
        <input className="field pl-9" aria-label="Search by address or note" placeholder="Search address or note" value={query} onChange={(e) => onQuery(e.target.value)} />
      </label>
      <select className="field w-auto" aria-label="Sort" value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="largest">Largest amount</option>
      </select>
      <button className="btn btn-ghost" onClick={onExport} aria-label="Export CSV">
        <Download className="size-4" /> <span className="hidden sm:inline">Export</span>
      </button>
      </div>
    </div>
  )
}

/** Column header row (desktop) plus a card that holds the rows. */
export function Table({ headers, cols, children }: { headers: string[]; cols: string; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className={`hidden gap-3 border-b px-4 py-3 md:grid ${cols}`} style={{ borderColor: 'var(--border)' }}>
        {headers.map((h) => (
          <span key={h} className="eyebrow">
            {h}
          </span>
        ))}
      </div>
      {children}
    </div>
  )
}

export function TableSkeleton() {
  return (
    <div className="card space-y-3 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-12" />
      ))}
    </div>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-md"
      style={{ color: 'var(--subtle)' }}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function ConnectEmpty() {
  const { openEmail } = useSession()
  return (
    <div className="card">
      <EmptyState
        title="Connect your wallet"
        body="Connect to see the payouts you send and receive, and to create new ones."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button className="btn btn-primary" onClick={show}>
                  Connect wallet
                </button>
              )}
            </ConnectKitButton.Custom>
            {!IS_MAINNET && (
              <button className="btn btn-ghost" onClick={openEmail}>
                Sign up with email
              </button>
            )}
          </div>
        }
      />
    </div>
  )
}
