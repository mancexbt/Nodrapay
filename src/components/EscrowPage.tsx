import { useState } from 'react'
import { useAccount } from '@/hooks/useAccount'
import { Check, Plus } from 'lucide-react'
import { zeroAddress } from 'viem'
import { Badge, EmptyState, Progress, Sheet, Stat, TxButton } from '@/components/ui'
import { ConnectEmpty, Identity, PageHeader, Table, TableSkeleton, Toolbar, type Direction } from '@/components/table'
import { useVaultTx } from '@/hooks/useVaultTx'
import {
  ARBITER_GRACE_SECONDS,
  CHAIN_ID,
  DISPUTE_WINDOW_SECONDS,
  escrowClaimOpensAt,
  USDC_ADDRESS,
  ESCROW_STATUS_LABEL,
  VAULT_ADDRESS,
  downloadCsv,
  fmtDateTime,
  fmtToken,
  parseTokenInput,
  payoutVaultAbi,
  pct,
  sameAddr,
  shortAddr,
  sortBy,
  type EscrowView,
  type SortKey,
} from '@/lib/vault'
import { formatUnitsExact } from '@/onchain-money'

const COLS = 'grid-cols-[1fr_auto] md:grid-cols-[1.4fr_1.2fr_1fr_.8fr_1.1fr]'
const statusTone = (e: EscrowView) => (e.status === 0 ? 'neutral' : e.status === 1 ? 'success' : 'warn')

function EscrowDrawer({ escrow: e, me, now, onClose }: { escrow?: EscrowView; me?: string; now: bigint; onClose: () => void }) {
  const tx = useVaultTx()
  const [mode, setMode] = useState<'release' | 'refund' | null>(null)
  const [amount, setAmount] = useState('')
  const [confirmDispute, setConfirmDispute] = useState(false)

  let body = null
  if (e) {
    const isDepositor = sameAddr(e.depositor, me)
    const isBeneficiary = sameAddr(e.beneficiary, me)
    const isArbiter = sameAddr(e.arbiter, me)
    const hasArbiter = e.arbiter !== zeroAddress
    const hasMilestones = e.milestones.length > 0
    const active = e.status === 0 && e.remaining > 0n
    const refundOpensAt = e.deadline + (hasArbiter ? ARBITER_GRACE_SECONDS : 0n)
    const claimOpensAt = escrowClaimOpensAt(e)
    const disputeBlocksClaim = e.disputed && now < e.disputedAt + DISPUTE_WINDOW_SECONDS
    const depositorCanRefund = isDepositor && now > refundOpensAt
    const canRelease = active && (isDepositor || isArbiter)
    const canRefund = active && (isArbiter || isBeneficiary || depositorCanRefund)
    const canClaim = active && isBeneficiary && now >= claimOpensAt && !disputeBlocksClaim
    const canDispute = active && (isDepositor || isBeneficiary) && e.disputedAt === 0n
    const canWithdraw = e.disputed && sameAddr(e.disputedBy, me)
    const f = (v: bigint) => fmtToken(v, e.decimals)
    const amountRaw = parseTokenInput(amount, e.decimals)
    const valid = !!amountRaw && amountRaw <= e.remaining
    const call = (functionName: 'claimEscrow' | 'dispute' | 'withdrawDispute', label: string, done: string) =>
      tx.execute([{ label, send: () => tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName, args: [e.id], chainId: CHAIN_ID }) }], done)

    const choose = (next: 'release' | 'refund') => {
      setMode(mode === next ? null : next)
      setAmount(formatUnitsExact(e.remaining, e.decimals))
    }
    const submit = async () => {
      if (!mode || !amountRaw || !valid) return
      const ok = await tx.execute(
        [
          {
            label: mode === 'release' ? 'Release' : 'Refund',
            send: () =>
              mode === 'release'
                ? tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'releaseEscrow', args: [e.id, amountRaw], chainId: CHAIN_ID })
                : tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'refundEscrow', args: [e.id, amountRaw], chainId: CHAIN_ID }),
          },
        ],
        mode === 'release' ? 'Funds released.' : 'Funds refunded.',
      )
      if (ok) setMode(null)
    }
    const releaseMilestone = (index: number) =>
      tx.execute(
        [{ label: 'Release milestone', send: () => tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'releaseMilestone', args: [e.id, BigInt(index)], chainId: CHAIN_ID }) }],
        'Milestone released.',
      )
    const fraction = (num: bigint) => setAmount(formatUnitsExact((e.remaining * num) / 100n, e.decimals))
    const showAmountRelease = canRelease && !hasMilestones

    body = (
      <>
        <div className="inner p-4">
          <div className="flex items-start justify-between gap-3">
            <Stat label="Held in escrow" value={f(e.remaining)} sub={`of ${f(e.amount)} ${e.symbol}`} big />
            <div className="flex flex-col items-end gap-1.5">
              <Badge tone={statusTone(e)}>{ESCROW_STATUS_LABEL[e.status]}</Badge>
              {e.disputed && <Badge tone="warn">Disputed</Badge>}
            </div>
          </div>
          <div className="mt-4">
            <Progress claimedPct={pct(e.released, e.amount)} unlockedPct={pct(e.released + e.refunded, e.amount)} height={8} />
            <div className="mt-2 flex justify-between text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              <span>Released {f(e.released)}</span>
              <span>Refunded {f(e.refunded)}</span>
            </div>
          </div>
        </div>

        {hasMilestones && (
          <section className="inner p-4" aria-label="Milestones">
            <p className="eyebrow mb-2">Milestones</p>
            <ul className="space-y-2">
              {e.milestones.map((m, i) => {
                const done = m.released
                const affordable = m.amount <= e.remaining
                return (
                  <li key={`${i}-${m.title}`} className="flex items-center gap-3">
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={done ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--chip)', color: 'var(--ink-2)' }}
                    >
                      {done ? <Check className="size-3" /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.title}</p>
                      <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                        {f(m.amount)} {e.symbol} · {done ? 'Released' : affordable ? 'Pending' : 'Not enough left'}
                      </p>
                    </div>
                    {canRelease && !done && affordable && (
                      <TxButton small tone="ghost" ready onClick={() => releaseMilestone(i)} label="Release" phase={tx.phase} stepLabel={tx.stepLabel} />
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <dl className="inner grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-sm">
          <dt style={{ color: 'var(--subtle)' }}>Token</dt>
          <dd className="mono text-right">{sameAddr(e.token, USDC_ADDRESS) ? e.symbol : `${e.symbol} · ${shortAddr(e.token)}`}</dd>
          <dt style={{ color: 'var(--subtle)' }}>From</dt>
          <dd className="mono text-right">{shortAddr(e.depositor)}{isDepositor ? ' (you)' : ''}</dd>
          <dt style={{ color: 'var(--subtle)' }}>To</dt>
          <dd className="mono text-right">{shortAddr(e.beneficiary)}{isBeneficiary ? ' (you)' : ''}</dd>
          <dt style={{ color: 'var(--subtle)' }}>Arbiter</dt>
          <dd className="mono text-right">{hasArbiter ? `${shortAddr(e.arbiter)}${isArbiter ? ' (you)' : ''}` : 'None'}</dd>
          <dt style={{ color: 'var(--subtle)' }}>Deadline</dt>
          <dd className="text-right">{fmtDateTime(e.deadline)}</dd>
          <dt style={{ color: 'var(--subtle)' }}>Depositor can refund from</dt>
          <dd className="text-right">{fmtDateTime(refundOpensAt)}</dd>
          <dt style={{ color: 'var(--subtle)' }}>Recipient can claim from</dt>
          <dd className="text-right">{fmtDateTime(claimOpensAt)}</dd>
          {e.disputedAt > 0n && (
            <>
              <dt style={{ color: 'var(--subtle)' }}>Dispute raised</dt>
              <dd className="text-right">
                {fmtDateTime(e.disputedAt)} by {sameAddr(e.disputedBy, e.depositor) ? 'depositor' : sameAddr(e.disputedBy, e.beneficiary) ? 'recipient' : 'arbiter'}
                {!e.disputed ? ' (closed)' : ''}
              </dd>
            </>
          )}
          {e.memo && (
            <>
              <dt style={{ color: 'var(--subtle)' }}>Note</dt>
              <dd className="text-right">{e.memo}</dd>
            </>
          )}
        </dl>

        {(showAmountRelease || canRefund) && (
          <div className="grid grid-cols-2 gap-2">
            {showAmountRelease && (
              <button className={`btn ${mode === 'release' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => choose('release')}>
                Release
              </button>
            )}
            {canRefund && (
              <button className={`btn ${mode === 'refund' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => choose('refund')}>
                Refund
              </button>
            )}
          </div>
        )}

        {canClaim && (
          <div className="space-y-1.5">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              The deadline and grace period have passed with no release. You can claim what is left.
            </p>
            <TxButton ready onClick={() => call('claimEscrow', 'Claim', 'Funds claimed.')} label={`Claim ${f(e.remaining)} ${e.symbol}`} phase={tx.phase} stepLabel={tx.stepLabel} />
          </div>
        )}
        {active && isBeneficiary && !canClaim && (
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            {disputeBlocksClaim
              ? `A dispute is open, so claiming is paused until ${fmtDateTime(e.disputedAt + DISPUTE_WINDOW_SECONDS)} unless it is withdrawn or ruled on.`
              : `If nobody releases or refunds this by ${fmtDateTime(claimOpensAt)}, you can claim what is left.`}
          </p>
        )}
        {active && isDepositor && !depositorCanRefund && (
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            You can reclaim what is left after {fmtDateTime(refundOpensAt)}.
          </p>
        )}

        {mode && (
          <div className="inner space-y-3 p-4">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {mode === 'release' ? `Pay ${shortAddr(e.beneficiary)}. Release part of it, or all of it.` : `Return funds to ${shortAddr(e.depositor)}.`}
            </p>
            <div className="flex items-center gap-2">
              <input
                className="field tabular-nums"
                aria-label="Amount"
                inputMode="decimal"
                value={amount}
                onChange={(ev) => new RegExp(`^\\d*\\.?\\d{0,${Math.min(e.decimals, 18)}}$`).test(ev.target.value) && setAmount(ev.target.value)}
              />
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                {e.symbol}
              </span>
            </div>
            <div className="flex gap-2">
              {[25n, 50n, 100n].map((pctValue) => (
                <button key={pctValue.toString()} className="btn btn-ghost btn-sm flex-1" onClick={() => fraction(pctValue)}>
                  {pctValue === 100n ? 'All' : `${pctValue}%`}
                </button>
              ))}
            </div>
            {amount !== '' && !valid && (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                Enter an amount up to {f(e.remaining)}.
              </p>
            )}
            <TxButton ready={valid} onClick={submit} label={mode === 'release' ? 'Confirm release' : 'Confirm refund'} phase={tx.phase} stepLabel={tx.stepLabel} />
          </div>
        )}

        {(canDispute || canWithdraw) && (
          <section className="inner space-y-2 p-4" aria-label="Dispute">
            <p className="eyebrow">Dispute</p>
            {canWithdraw ? (
              <>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  You raised a dispute. Withdrawing it lets the recipient claim again once the claim date has passed. A dispute cannot be raised twice.
                </p>
                <TxButton ready onClick={() => call('withdrawDispute', 'Withdraw dispute', 'Dispute withdrawn.')} tone="ghost" label="Withdraw dispute" phase={tx.phase} stepLabel={tx.stepLabel} />
              </>
            ) : !confirmDispute ? (
              <>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Flag a problem. It pauses the recipient&apos;s right to claim for 30 days. It does not freeze the funds: the depositor{hasArbiter ? ' or arbiter' : ''} can still release or refund. Each escrow can be disputed once.
                </p>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDispute(true)}>
                  Raise a dispute
                </button>
              </>
            ) : (
              <>
                <p className="text-xs font-medium" style={{ color: 'var(--warn)' }}>
                  Raise the one dispute this escrow allows?
                </p>
                <TxButton
                  tone="danger"
                  ready
                  onClick={async () => {
                    if (await call('dispute', 'Raise dispute', 'Dispute raised.')) setConfirmDispute(false)
                  }}
                  label="Confirm dispute"
                  phase={tx.phase}
                  stepLabel={tx.stepLabel}
                />
              </>
            )}
          </section>
        )}
      </>
    )
  }

  return (
    <Sheet open={!!e} onClose={onClose} eyebrow={e ? `Escrow #${e.id.toString()}` : undefined} title={e?.memo || 'Escrow'}>
      {body}
    </Sheet>
  )
}

export function EscrowPage({ escrows, loading, now, onNew }: { escrows: EscrowView[]; loading: boolean; now: bigint; onNew: () => void }) {
  const { address, isConnected } = useAccount()
  const [direction, setDirection] = useState<Direction>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [selectedId, setSelectedId] = useState<bigint | null>(null)

  const counts = {
    all: escrows.length,
    in: escrows.filter((e) => sameAddr(e.beneficiary, address)).length,
    out: escrows.filter((e) => sameAddr(e.depositor, address)).length,
  }
  const q = query.trim().toLowerCase()
  const items = sortBy(escrows, sort, (e) => e.amount).filter((e) => {
    if (direction === 'in' && !sameAddr(e.beneficiary, address)) return false
    if (direction === 'out' && !sameAddr(e.depositor, address)) return false
    return !q || e.beneficiary.toLowerCase().includes(q) || e.depositor.toLowerCase().includes(q) || e.memo.toLowerCase().includes(q)
  })
  const exportCsv = () =>
    downloadCsv('nodra-escrows.csv', [
      ['id', 'direction', 'token', 'token_address', 'from', 'to', 'arbiter', 'amount', 'released', 'refunded', 'remaining', 'status', 'disputed', 'milestones', 'deadline', 'note'],
      ...items.map((e) => [
        e.id.toString(),
        sameAddr(e.beneficiary, address) ? 'incoming' : 'outgoing',
        e.symbol,
        e.token,
        e.depositor,
        e.beneficiary,
        e.arbiter,
        formatUnitsExact(e.amount, e.decimals),
        formatUnitsExact(e.released, e.decimals),
        formatUnitsExact(e.refunded, e.decimals),
        formatUnitsExact(e.remaining, e.decimals),
        ESCROW_STATUS_LABEL[e.status],
        e.disputed ? 'yes' : 'no',
        e.milestones.map((m) => m.title).join(' | '),
        new Date(Number(e.deadline) * 1000).toISOString(),
        e.memo,
      ]),
    ])
  const selected = selectedId === null ? undefined : escrows.find((e) => e.id === selectedId)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Escrow"
        blurb="Funds held until you approve, with an optional arbiter."
        action={
          <button className="btn btn-primary" onClick={onNew}>
            <Plus className="size-4" /> New escrow
          </button>
        }
      />
      {escrows.length > 0 && <Toolbar direction={direction} onDirection={setDirection} query={query} onQuery={setQuery} counts={counts} sort={sort} onSort={setSort} onExport={exportCsv} />}
      {!isConnected ? (
        <ConnectEmpty />
      ) : loading ? (
        <TableSkeleton />
      ) : escrows.length === 0 ? (
        <div className="card">
          <EmptyState title="No escrows yet" body="Lock tokens for a freelancer or supplier and release it when the work is done." />
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title="No matches" body="Try another filter or search term." />
        </div>
      ) : (
        <Table headers={['Counterparty', 'Released', 'Amount', 'Held', 'Status']} cols="md:grid-cols-[1.4fr_1.2fr_1fr_.8fr_1.1fr]">
          {items.map((e) => {
            const incoming = sameAddr(e.beneficiary, address)
            const progress = <Progress claimedPct={pct(e.released, e.amount)} unlockedPct={pct(e.released + e.refunded, e.amount)} />
            return (
              <button key={e.id.toString()} className={`row ${COLS}`} onClick={() => setSelectedId(e.id)} aria-label={`Open escrow ${e.id.toString()}`}>
                <Identity
                  address={incoming ? e.depositor : e.beneficiary}
                  sub={`${incoming ? 'Incoming' : sameAddr(e.arbiter, address) ? 'Arbiter' : 'Outgoing'}${e.milestones.length ? ` · ${e.milestones.filter((m) => m.released).length}/${e.milestones.length} milestones` : ''}${e.memo ? ` · ${e.memo}` : ''}`}
                />
                <div className="hidden md:block">
                  {progress}
                  <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                    {pct(e.released, e.amount).toFixed(1)}% released
                  </p>
                </div>
                <p className="text-right text-sm font-semibold tabular-nums md:text-left">{fmtToken(e.amount, e.decimals)} {e.symbol}</p>
                <p className="hidden text-sm tabular-nums md:block" style={{ color: 'var(--muted)' }}>
                  {fmtToken(e.remaining, e.decimals)}
                </p>
                <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:block">
                  <div className="flex-1 md:hidden">{progress}</div>
                  <Badge tone={e.disputed && e.status === 0 ? 'warn' : statusTone(e)}>{e.disputed && e.status === 0 ? 'Disputed' : ESCROW_STATUS_LABEL[e.status]}</Badge>
                </div>
              </button>
            )
          })}
        </Table>
      )}
      <EscrowDrawer escrow={selected} me={address} now={now} onClose={() => setSelectedId(null)} />
    </div>
  )
}
