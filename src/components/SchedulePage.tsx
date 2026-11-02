import { useMemo, useState } from 'react'
import { useAccount } from '@/hooks/useAccount'
import { Plus } from 'lucide-react'
import { Badge, EmptyState, Progress } from '@/components/ui'
import { formatUnitsExact } from '@/onchain-money'
import { PLAN_BY_KIND } from '@/lib/plans'
import { ConnectEmpty, Identity, PageHeader, Table, TableSkeleton, Toolbar, type Direction } from '@/components/table'
import { ScheduleDrawer } from '@/components/ScheduleDrawer'
import { downloadCsv, fmtCadence, fmtToken, pct, sortBy, KIND_META, releasableAt, sameAddr, scheduleEnd, scheduleStatus, unlockedAt, type KindId, type ScheduleView, type SortKey } from '@/lib/vault'

const COLS = 'grid-cols-[1fr_auto] md:grid-cols-[1.4fr_1.2fr_1fr_.8fr_1.1fr]'

export function SchedulePage({ kind, schedules, loading, now, onNew }: { kind: KindId; schedules: ScheduleView[]; loading: boolean; now: bigint; onNew: () => void }) {
  const { address, isConnected } = useAccount()
  const copy = PLAN_BY_KIND[kind]
  const [direction, setDirection] = useState<Direction>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [selectedId, setSelectedId] = useState<bigint | null>(null)

  const ofKind = useMemo(() => schedules.filter((s) => s.kind === kind), [schedules, kind])
  const counts = {
    all: ofKind.length,
    in: ofKind.filter((s) => sameAddr(s.beneficiary, address)).length,
    out: ofKind.filter((s) => sameAddr(s.funder, address)).length,
  }
  const q = query.trim().toLowerCase()
  const items = sortBy(ofKind, sort, (s) => s.total).filter((s) => {
    if (direction === 'in' && !sameAddr(s.beneficiary, address)) return false
    if (direction === 'out' && !sameAddr(s.funder, address)) return false
    return !q || s.beneficiary.toLowerCase().includes(q) || s.funder.toLowerCase().includes(q) || s.memo.toLowerCase().includes(q)
  })
  const exportCsv = () =>
    downloadCsv(`nodra-${copy.title.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['id', 'type', 'direction', 'token', 'token_address', 'from', 'to', 'total', 'claimed', 'unlocked', 'status', 'start', 'end', 'note'],
      ...items.map((s) => [
        s.id.toString(),
        KIND_META[kind].label,
        sameAddr(s.beneficiary, address) ? 'incoming' : 'outgoing',
        s.symbol,
        s.token,
        s.funder,
        s.beneficiary,
        formatUnitsExact(s.total, s.decimals),
        formatUnitsExact(s.claimed, s.decimals),
        formatUnitsExact(unlockedAt(s, now), s.decimals),
        scheduleStatus(s, now).label,
        new Date(Number(s.start) * 1000).toISOString(),
        new Date(Number(scheduleEnd(s)) * 1000).toISOString(),
        s.memo,
      ]),
    ])
  const selected = selectedId === null ? undefined : schedules.find((s) => s.id === selectedId)

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy.title}
        blurb={copy.blurb}
        action={
          <button className="btn btn-primary" onClick={onNew}>
            <Plus className="size-4" /> {copy.cta}
          </button>
        }
      />
      {ofKind.length > 0 && <Toolbar direction={direction} onDirection={setDirection} query={query} onQuery={setQuery} counts={counts} sort={sort} onSort={setSort} onExport={exportCsv} />}
      {!isConnected ? (
        <ConnectEmpty />
      ) : loading ? (
        <TableSkeleton />
      ) : ofKind.length === 0 ? (
        <div className="card">
          <EmptyState title={copy.emptyTitle} body={copy.emptyBody} />
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title="No matches" body="Try another filter or search term." />
        </div>
      ) : (
        <Table headers={['Counterparty', 'Progress', 'Total', 'Claimable', 'Status']} cols="md:grid-cols-[1.4fr_1.2fr_1fr_.8fr_1.1fr]">
          {items.map((s) => {
            const incoming = sameAddr(s.beneficiary, address)
            const selfLock = incoming && sameAddr(s.funder, address)
            const unlocked = unlockedAt(s, now)
            const claimable = releasableAt(s, now)
            const status = scheduleStatus(s, now)
            const progress = <Progress claimedPct={pct(s.claimed, s.total)} unlockedPct={pct(unlocked, s.total)} />
            return (
              <button key={s.id.toString()} className={`row ${COLS}`} onClick={() => setSelectedId(s.id)} aria-label={`Open ${copy.title} ${s.id.toString()}`}>
                <Identity
                  address={incoming ? s.funder : s.beneficiary}
                  sub={`${selfLock ? 'Locked by you' : incoming ? 'Incoming' : 'Outgoing'}${kind === 1 ? ` · ${fmtCadence(s.stepDuration)}` : ''}${s.memo ? ` · ${s.memo}` : ''}`}
                />
                <div className="hidden md:block">
                  {progress}
                  <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                    {pct(unlocked, s.total).toFixed(1)}% unlocked
                  </p>
                </div>
                <p className="text-right text-sm font-semibold tabular-nums md:text-left">{fmtToken(s.total, s.decimals)} <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>{s.symbol}</span></p>
                <p className="hidden text-sm tabular-nums md:block" style={{ color: claimable > 0n ? 'var(--success)' : 'var(--subtle)' }}>
                  {fmtToken(claimable, s.decimals)}
                </p>
                <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:block">
                  <div className="flex-1 md:hidden">{progress}</div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
              </button>
            )
          })}
        </Table>
      )}
      <ScheduleDrawer schedule={selected} me={address} now={now} onClose={() => setSelectedId(null)} />
    </div>
  )
}
