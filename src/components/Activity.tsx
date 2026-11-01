import { ArrowDownLeft, ArrowUpRight, ExternalLink, Circle } from 'lucide-react'
import { fmtToken, CHAIN_ID } from '@/lib/vault'
import type { ActivityItem } from '@/hooks/useActivity'
import { buildTxExplorerUrl } from '@/onchain-facts'

function ago(at: bigint, now: bigint): string {
  const s = Number(now - at)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function Activity({ items, loading, now }: { items: ActivityItem[]; loading: boolean; now: bigint }) {
  return (
    <section className="card p-5">
      <div className="mb-3">
        <h2 className="display text-lg font-semibold">Recent activity</h2>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-11" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
          Your transactions will show up here.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full" style={{ background: item.tone === 'in' ? 'var(--accent-soft)' : 'var(--chip)' }}>
                {item.tone === 'in' ? <ArrowDownLeft className="size-4" style={{ color: 'var(--success)' }} /> : item.tone === 'out' ? <ArrowUpRight className="size-4" /> : <Circle className="size-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  {item.at > 0n ? ago(item.at, now) : ''}
                </p>
              </div>
              {item.amount > 0n && (
                <p className="shrink-0 text-sm font-semibold tabular-nums">
                  {fmtToken(item.amount, item.decimals)} <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>{item.symbol}</span>
                </p>
              )}
              <a
                href={buildTxExplorerUrl(CHAIN_ID, item.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View transaction"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                style={{ color: 'var(--subtle)' }}
              >
                <ExternalLink className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
