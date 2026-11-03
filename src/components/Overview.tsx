import { TAGLINE } from '@/lib/network'
import { useMemo } from 'react'
import { useAccount } from '@/hooks/useAccount'
import { FlowGraphic } from '@/components/FlowGraphic'
import { Identity } from '@/components/table'
import { Activity } from '@/components/Activity'
import { AlertsCard } from '@/components/AlertsCard'
import { useActivity } from '@/hooks/useActivity'
import type { VaultData } from '@/hooks/useVaultData'
import { PLAN_PAGES, type PageId } from '@/lib/plans'
import {
  KIND_META,
  DISPUTE_WINDOW_SECONDS,
  escrowClaimOpensAt,
  fmtDateTime,
  fmtSpan,
  fmtToken,
  isContinuous,
  nextUnlockAt,
  releasableAt,
  sameAddr,
  unlockedByParams,
  type KindId,
} from '@/lib/vault'

export function Overview({ data, loading, now, onOpen }: { data?: VaultData; loading: boolean; now: bigint; onOpen: (page: PageId) => void }) {
  const { address, isConnected } = useAccount()
  const activity = useActivity(address, data)

  const summary = useMemo(() => {
    const upcoming: { id: bigint; kind: KindId; at: bigint; amount: bigint; who: string; symbol: string; decimals: number }[] = []
    for (const s of data?.schedules ?? []) {
      if (sameAddr(s.beneficiary, address)) {
        if (!s.cancelled && s.claimed < s.total) {
          const at = nextUnlockAt(s, now)
          if (at !== null && !isContinuous(s)) {
            upcoming.push({ id: s.id, kind: s.kind as KindId, at, amount: unlockedByParams(s, at) - unlockedByParams(s, now), who: s.funder, symbol: s.symbol, decimals: s.decimals })
          }
        }
      }
    }
    upcoming.sort((a, b) => (a.at < b.at ? -1 : 1))

    // Things a person has to do next, derived from the same on-chain state.
    const actions: { key: string; title: string; detail: string; page: PageId }[] = []
    for (const e of data?.escrows ?? []) {
      if (e.status !== 0 || e.remaining === 0n) continue
      const label = e.memo || `Escrow #${e.id.toString()}`
      const amount = `${fmtToken(e.remaining, e.decimals)} ${e.symbol}`
      const pendingMilestones = e.milestones.filter((m) => !m.released).length
      if (sameAddr(e.depositor, address) || sameAddr(e.arbiter, address)) {
        actions.push({ key: `r-${e.id}`, title: `Release or review: ${label}`, detail: `${amount} held${pendingMilestones ? ` · ${pendingMilestones} milestones pending` : ''}`, page: 'escrow' })
      }
      const blocked = e.disputed && now < e.disputedAt + DISPUTE_WINDOW_SECONDS
      if (sameAddr(e.beneficiary, address) && now >= escrowClaimOpensAt(e) && !blocked) {
        actions.push({ key: `c-${e.id}`, title: `Claim: ${label}`, detail: `${amount} is claimable now`, page: 'escrow' })
      }
    }
    for (const s of data?.schedules ?? []) {
      if (sameAddr(s.beneficiary, address) && releasableAt(s, now) > 0n) {
        actions.push({ key: `s-${s.id}`, title: `Claim ${fmtToken(releasableAt(s, now), s.decimals)} ${s.symbol}`, detail: `${KIND_META[s.kind as KindId].label}${s.memo ? ` · ${s.memo}` : ''}`, page: PLAN_PAGES.find((p) => p.kind === s.kind)?.id ?? 'overview' })
      }
    }
    return { upcoming: upcoming.slice(0, 3), actions: actions.slice(0, 4), actionCount: actions.length }
  }, [data, address, now])


  return (
    <div className="space-y-5">
      <section
        aria-label={TAGLINE}
        className="card relative overflow-hidden p-6 sm:p-8"
        style={{ background: 'linear-gradient(120deg, rgba(134,237,207,0.38) 0%, rgba(94,221,77,0.14) 48%, #ffffff 100%)' }}
      >
        <p className="eyebrow">Nodra</p>
        <h1 className="display mt-2 max-w-2xl text-balance text-4xl font-bold leading-tight sm:text-5xl">
          Escrow and conditional payouts for{' '}
          <span style={{ background: 'linear-gradient(90deg, #05b959, #0a8f6a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>businesses</span>
        </h1>
        <p className="mt-3 max-w-lg text-pretty text-sm sm:text-base" style={{ color: 'var(--muted)' }}>
          Lock funds and release them as work is approved.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="What you can do">
          {['Milestones'].map((c) => (
            <li key={c} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.75)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              {c}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => onOpen('escrow')}>
            Open the app
          </button>
          <a href="#/about" className="btn btn-ghost">
            About Nodra
          </a>
        </div>
        <FlowGraphic />
      </section>

      {isConnected && <AlertsCard />}

      {isConnected && summary.actions.length > 0 && (
        <section className="card p-5" aria-label="Needs your action">
          <h2 className="display mb-3 text-lg font-semibold">
            Needs your action <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>({summary.actionCount})</span>
          </h2>
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {summary.actions.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--subtle)' }}>
                    {a.detail}
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm shrink-0" onClick={() => onOpen(a.page)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isConnected && (
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="display mb-3 text-lg font-semibold">Coming up</h2>
          {summary.upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
              Nothing is due to unlock soon.
            </p>
          ) : (
            <ul className="space-y-3">
              {summary.upcoming.map((u) => (
                <li key={`${u.id}-${u.at}`} className="flex items-center justify-between gap-3">
                  <Identity address={u.who} sub={`${KIND_META[u.kind].label} · ${fmtDateTime(u.at)}`} />
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      +{fmtToken(u.amount, u.decimals)} {u.symbol}
                    </p>
                    <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                      in {fmtSpan(u.at - now)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Activity items={(activity.data?.items ?? []).slice(0, 5)} loading={loading || activity.isLoading} now={now} />
      </div>
      )}
    </div>
  )
}
