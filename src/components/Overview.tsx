import { TAGLINE } from '@/lib/network'
import { useMemo, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from '@/hooks/useAccount'
import { ChevronDown, Plus } from 'lucide-react'
import { Identity } from '@/components/table'
import { Activity } from '@/components/Activity'
import { AlertsCard } from '@/components/AlertsCard'
import { GetStarted } from '@/components/GettingStarted'
import { Landing } from '@/components/Landing'
import { useActivity } from '@/hooks/useActivity'
import type { VaultData } from '@/hooks/useVaultData'
import { GROUP_LABEL, PLAN_PAGES, type CreateKind, type NavGroup, type PageId } from '@/lib/plans'
import {
  KIND_META,
  DISPUTE_WINDOW_SECONDS,
  escrowClaimOpensAt,
  USDC_ADDRESS,
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

interface Entry {
  symbol: string
  decimals: number
  raw: bigint
  token: string
}
type Totals = Map<string, Entry>

function add(map: Totals, item: { token: string; symbol: string; decimals: number }, raw: bigint) {
  const key = item.token.toLowerCase()
  const prev = map.get(key)
  map.set(key, { symbol: item.symbol, decimals: item.decimals, token: key, raw: (prev?.raw ?? 0n) + raw })
}

/** Different tokens are never added together: show the main one big and list the rest. */
function summarize(map: Totals): { value: string; sub: string; text: string } {
  const entries = [...map.values()].sort((a, b) => {
    if (a.token === USDC_ADDRESS.toLowerCase()) return -1
    if (b.token === USDC_ADDRESS.toLowerCase()) return 1
    return a.raw < b.raw ? 1 : -1
  })
  if (entries.length === 0) return { value: '0.00', sub: 'USDC', text: '0.00 USDC' }
  const [first, ...rest] = entries
  const sub = rest.length ? `${first.symbol} + ${rest.map((r) => `${fmtToken(r.raw, r.decimals)} ${r.symbol}`).join(', ')}` : first.symbol
  return { value: fmtToken(first.raw, first.decimals), sub, text: `${fmtToken(first.raw, first.decimals)} ${sub}` }
}

const MENU_GROUPS: { label: string; items: { id: CreateKind; label: string; hint: string }[] }[] = (['payments', 'plans', 'locks'] as NavGroup[]).map((g) => ({
  label: GROUP_LABEL[g],
  items: [
    ...(g === 'payments' ? [{ id: 'escrow' as CreateKind, label: 'Escrow', hint: 'Hold funds until approved' }] : []),
    ...PLAN_PAGES.filter((p) => p.group === g).map((p) => ({ id: p.id as CreateKind, label: p.title, hint: p.blurb })),
  ],
}))

function CreateMenu({ onPick }: { onPick: (k: CreateKind) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Plus className="size-4" /> Create <ChevronDown className="size-4" />
      </button>
      {open && (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="card absolute right-0 z-40 mt-2 max-h-[70dvh] w-80 overflow-y-auto p-1.5" style={{ background: 'var(--sheet-bg)', boxShadow: '0 18px 40px -16px rgba(0,21,13,0.3)' }}>
            {MENU_GROUPS.map((group) => (
              <div key={group.label} className="pb-1">
                <p className="eyebrow px-3 pb-1 pt-2">{group.label}</p>
                {group.items.map((m) => (
                  <button
                    key={m.id}
                    role="menuitem"
                    className="nav-item h-auto flex-col items-start gap-0 py-2 text-left"
                    onClick={() => {
                      setOpen(false)
                      onPick(m.id)
                    }}
                  >
                    <span style={{ color: 'var(--ink)' }}>{m.label}</span>
                    <span className="line-clamp-1 text-xs font-normal" style={{ color: 'var(--subtle)' }}>
                      {m.hint}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function Overview({ data, loading, now, balance, onCreate, onOpen, onEmail }: { data?: VaultData; loading: boolean; now: bigint; balance?: bigint; onCreate: (k: CreateKind) => void; onOpen: (page: PageId) => void; onEmail?: () => void }) {
  const { address, isConnected } = useAccount()
  const activity = useActivity(address, data)

  const summary = useMemo(() => {
    const claimable: Totals = new Map()
    const incoming: Totals = new Map()
    const committed: Totals = new Map()
    const upcoming: { id: bigint; kind: KindId; at: bigint; amount: bigint; who: string; symbol: string; decimals: number }[] = []
    for (const s of data?.schedules ?? []) {
      const outstanding = s.total - s.claimed
      if (sameAddr(s.beneficiary, address)) {
        const ready = releasableAt(s, now)
        add(claimable, s, ready)
        add(incoming, s, outstanding - ready)
        if (!s.cancelled && s.claimed < s.total) {
          const at = nextUnlockAt(s, now)
          if (at !== null && !isContinuous(s)) {
            upcoming.push({ id: s.id, kind: s.kind as KindId, at, amount: unlockedByParams(s, at) - unlockedByParams(s, now), who: s.funder, symbol: s.symbol, decimals: s.decimals })
          }
        }
      }
      // Tokens you locked for yourself already show under "locked for you".
      if (sameAddr(s.funder, address) && !sameAddr(s.beneficiary, address)) add(committed, s, outstanding)
    }
    for (const e of data?.escrows ?? []) {
      if (sameAddr(e.beneficiary, address)) add(incoming, e, e.remaining)
      if (sameAddr(e.depositor, address)) add(committed, e, e.remaining)
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
    return { claimable, incoming, committed, upcoming: upcoming.slice(0, 3), actions: actions.slice(0, 4), actionCount: actions.length }
  }, [data, address, now])

  const claimable = summarize(summary.claimable)
  const incoming = summarize(summary.incoming)
  const committed = summarize(summary.committed)
  const dash = loading ? '...' : undefined

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
          <span style={{ background: 'linear-gradient(90deg, #05b959, #0a8f6a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>USDC</span>
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
          {isConnected ? (
            <>
              <CreateMenu onPick={onCreate} />
              <button className="btn btn-ghost" onClick={() => onOpen('escrow')}>
                Open the app
              </button>
            </>
          ) : (
            <>
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <button className="btn btn-primary" onClick={show}>
                    Connect wallet
                  </button>
                )}
              </ConnectKitButton.Custom>
              {onEmail && (
                <button className="btn btn-ghost" onClick={onEmail}>
                  Continue with email
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => onOpen('escrow')}>
                Open the app
              </button>
            </>
          )}
        </div>
      </section>

      {!loading && <GetStarted isConnected={isConnected} balance={balance} data={data} onCreate={() => onCreate('escrow')} onBrowse={() => onOpen('escrow')} onEmail={onEmail} />}

      {!isConnected && <Landing onOpen={onOpen} />}

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
      <section className="card card-feature p-6">
        <p className="eyebrow">Claimable now</p>
        <p className="display mt-1 text-4xl font-bold tabular-nums [overflow-wrap:anywhere] sm:text-5xl">{dash ?? claimable.value}</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          {dash ? '' : claimable.sub}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.16)' }}>
          <div>
            <dt className="eyebrow">Locked for you</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums [overflow-wrap:anywhere]" style={{ color: '#fff' }}>
              {dash ?? incoming.text}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">You locked up</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums [overflow-wrap:anywhere]" style={{ color: '#fff' }}>
              {dash ?? committed.text}
            </dd>
          </div>
        </dl>
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

      <section className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4" aria-label="Open the app">
        <div>
          <p className="display text-base font-semibold">Everything else is in the app</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Escrows, payroll, vesting, lockups and claims, each with its own list and tools.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => onOpen('escrow')}>
          Open the app
        </button>
      </section>
    </div>
  )
}
