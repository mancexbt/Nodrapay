import { useState } from 'react'
import { useContext } from 'react'
import { ExternalLink } from 'lucide-react'
import type { Address } from 'viem'
import { Badge, Field, Progress, Sheet, Stat, TxButton } from '@/components/ui'
import { UnlockChart } from '@/components/UnlockChart'
import { CopyButton } from '@/components/table'
import { useVaultTx } from '@/hooks/useVaultTx'
import { useTokenMeta } from '@/hooks/useVaultData'
import { ActivityContext, useBlockTimes } from '@/hooks/useActivity'
import {
  CHAIN_ID,
  KIND_META,
  USDC_ADDRESS,
  VAULT_ADDRESS,
  fmtCadence,
  fmtDateTime,
  fmtSpan,
  fmtToken,
  isContinuous,
  nextUnlockAt,
  payoutVaultAbi,
  pct,
  releasableAt,
  sameAddr,
  scheduleEnd,
  scheduleStatus,
  shortAddr,
  stepsDoneAt,
  unlockedAt,
  type KindId,
  type ScheduleView,
} from '@/lib/vault'
import { validAddress } from '@/lib/forms'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'

function AddressLink({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <a href={buildAddressExplorerUrl(CHAIN_ID, address)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 hover:underline">
        {shortAddr(address)} <ExternalLink className="size-3" />
      </a>
      <CopyButton value={address} label="Copy address" />
    </span>
  )
}

export function ScheduleDrawer({ schedule: s, me, now, onClose }: { schedule?: ScheduleView; me?: string; now: bigint; onClose: () => void }) {
  const tx = useVaultTx()
  const [redirecting, setRedirecting] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [extra, setExtra] = useState('')
  const activity = useContext(ActivityContext)
  const meta = useTokenMeta(s?.token ?? '')
  const history = (activity?.logs ?? [])
    .filter((l) => s !== undefined && (l.eventName === 'ScheduleReleased' || l.eventName === 'ScheduleExtended') && (l.args).id === s.id)
    .slice(-10)
    .reverse()
  const times = useBlockTimes(history.map((l) => l.blockNumber))

  const kind = (s?.kind ?? 0) as KindId
  const isBeneficiary = sameAddr(s?.beneficiary, me)
  const isFunder = sameAddr(s?.funder, me)

  const run = (label: string, success: string, send: () => Promise<`0x${string}`>) => tx.execute([{ label, send }], success)

  let body = null
  if (s) {
    const unlocked = unlockedAt(s, now)
    const releasable = releasableAt(s, now)
    const next = nextUnlockAt(s, now)
    const ended = now >= scheduleEnd(s)
    const status = scheduleStatus(s, now)
    const returnable = s.total - unlocked
    const f = (v: bigint) => fmtToken(v, s.decimals)

    const release = () => run('Release', 'Payment sent.', () => tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'release', args: [s.id], chainId: CHAIN_ID }))
    const releaseTo = async () => {
      if (!validAddress(recipient)) return
      const ok = await run('Send', 'Payment sent.', () =>
        tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'releaseTo', args: [s.id, recipient.trim() as Address], chainId: CHAIN_ID }),
      )
      if (ok) setRedirecting(false)
    }
    const perStep = s.total / BigInt(s.steps)
    const canExtend = isFunder && kind === 1 && !s.cancelled && !ended && s.total % BigInt(s.steps) === 0n
    const extraSteps = /^\d+$/.test(extra) ? Number(extra) : 0
    const extendCost = perStep * BigInt(extraSteps)
    const tooLong = (BigInt(s.steps) + BigInt(extraSteps)) * s.stepDuration > 20n * 365n * 86400n
    const extendProblem =
      extraSteps < 1 ? 'Enter how many periods to add.' : tooLong ? 'Payroll can run for at most 20 years.' : meta.balance !== undefined && extendCost > meta.balance ? `You need ${f(extendCost)} ${s.symbol} but hold ${f(meta.balance)}.` : null
    const extend = async () => {
      if (extendProblem) return
      const ok = await tx.execute(
        [
          tx.approveStep(s.token, extendCost, s.symbol),
          { label: 'Extend payroll', send: () => tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'extendSchedule', args: [s.id, extraSteps], chainId: CHAIN_ID }) },
        ],
        'Payroll extended.',
      )
      if (ok) setExtra('')
    }
    const cancel = async () => {
      const ok = await run('Cancel', 'Schedule cancelled.', () => tx.writeContractAsync({ address: VAULT_ADDRESS, abi: payoutVaultAbi, functionName: 'cancel', args: [s.id], chainId: CHAIN_ID }))
      if (ok) setConfirmCancel(false)
    }

    body = (
      <>
        <div className="inner p-4">
          <div className="flex items-start justify-between gap-3">
            <Stat label="Streamed so far" value={f(unlocked)} sub={`of ${f(s.total)} ${s.symbol}`} big />
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <div className="mt-4">
            <Progress claimedPct={pct(s.claimed, s.total)} unlockedPct={pct(unlocked, s.total)} height={8} />
            <div className="mt-2 flex justify-between text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              <span>Claimed {pct(s.claimed, s.total).toFixed(1)}%</span>
              <span>Unlocked {pct(unlocked, s.total).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {!s.cancelled && (
          <div className="inner p-3">
            <p className="eyebrow mb-1 px-1">Unlock schedule</p>
            <UnlockChart series={[s]} now={now} decimals={s.decimals} label={`Unlock schedule for ${KIND_META[kind].label.toLowerCase()} ${s.id.toString()}`} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="inner p-3.5">
            <Stat label="Claimable now" value={f(releasable)} sub={s.symbol} />
          </div>
          <div className="inner p-3.5">
            <Stat label="Claimed" value={f(s.claimed)} sub={s.symbol} />
          </div>
          <div className="inner p-3.5">
            <Stat label="Still locked" value={f(s.total - unlocked)} sub={s.symbol} />
          </div>
          <div className="inner p-3.5">
            <Stat label={next !== null ? 'Next unlock' : 'Unlock'} value={next !== null ? `in ${fmtSpan(next - now)}` : isContinuous(s) && !ended ? 'Continuous' : ended ? 'Complete' : '-'} />
          </div>
        </div>

        <dl className="inner grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-sm">
          <dt style={{ color: 'var(--subtle)' }}>Type</dt>
          <dd className="text-right">{KIND_META[kind].label}</dd>
          <dt style={{ color: 'var(--subtle)' }}>Token</dt>
          <dd className="text-right">
            {s.symbol} {!sameAddr(s.token, USDC_ADDRESS) && <AddressLink address={s.token} />}
          </dd>
          <dt style={{ color: 'var(--subtle)' }}>From</dt>
          <dd className="text-right">
            <AddressLink address={s.funder} />
          </dd>
          <dt style={{ color: 'var(--subtle)' }}>To</dt>
          <dd className="text-right">
            <AddressLink address={s.beneficiary} />
          </dd>
          {kind === 1 && !s.cancelled && (
            <>
              <dt style={{ color: 'var(--subtle)' }}>Pay</dt>
              <dd className="text-right tabular-nums">
                {f(s.total / BigInt(s.steps))} {fmtCadence(s.stepDuration)}
              </dd>
              <dt style={{ color: 'var(--subtle)' }}>Periods paid</dt>
              <dd className="text-right tabular-nums">
                {stepsDoneAt(s, now)} of {s.steps}
              </dd>
            </>
          )}
          {kind === 2 && s.cliff > 0n && (
            <>
              <dt style={{ color: 'var(--subtle)' }}>Cliff ends</dt>
              <dd className="text-right">{fmtDateTime(s.start + s.cliff)}</dd>
            </>
          )}
          <dt style={{ color: 'var(--subtle)' }}>{kind === 0 ? 'Unlocks' : 'Starts'}</dt>
          <dd className="text-right">{fmtDateTime(kind === 0 ? scheduleEnd(s) : s.start)}</dd>
          {kind !== 0 && (
            <>
              <dt style={{ color: 'var(--subtle)' }}>Ends</dt>
              <dd className="text-right">{fmtDateTime(scheduleEnd(s))}</dd>
            </>
          )}
          <dt style={{ color: 'var(--subtle)' }}>Cancelable</dt>
          <dd className="text-right">{s.cancelable ? 'Yes, by the sender' : 'No, locked in'}</dd>
          {s.memo && (
            <>
              <dt style={{ color: 'var(--subtle)' }}>Note</dt>
              <dd className="text-right">{s.memo}</dd>
            </>
          )}
        </dl>

        <div className="space-y-3">
          {releasable > 0n && (
            <TxButton
              ready
              onClick={release}
              label={isBeneficiary ? `Claim ${f(releasable)} ${s.symbol}` : `Send ${f(releasable)} ${s.symbol} to recipient`}
              phase={tx.phase}
              stepLabel={tx.stepLabel}
            />
          )}
          {isBeneficiary && releasable > 0n && (
            <button className="btn btn-ghost w-full" onClick={() => setRedirecting((v) => !v)}>
              Send to another wallet
            </button>
          )}
          {redirecting && (
            <div className="inner space-y-3 p-4">
              <Field label="Send this payment to" hint="Use this if the original wallet cannot receive this token.">
                <input className="field mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." spellCheck={false} />
              </Field>
              <TxButton ready={validAddress(recipient)} onClick={releaseTo} label={`Send ${f(releasable)} ${s.symbol}`} phase={tx.phase} stepLabel={tx.stepLabel} />
            </div>
          )}
          {isFunder && s.cancelable && !s.cancelled && !ended && (
            <button className="btn btn-danger w-full" onClick={() => setConfirmCancel((v) => !v)}>
              Cancel schedule
            </button>
          )}
          {confirmCancel && (
            <div className="inner space-y-3 p-4">
              <p className="text-pretty text-sm">
                {f(returnable)} {s.symbol} that has not unlocked returns to you. {f(unlocked - s.claimed)} {s.symbol} already unlocked stays claimable by the recipient.
              </p>
              <TxButton tone="danger" ready onClick={cancel} label="Confirm cancel" phase={tx.phase} stepLabel={tx.stepLabel} />
            </div>
          )}
        </div>

        {canExtend && (
          <section className="inner space-y-3 p-4" aria-label="Extend payroll">
            <p className="eyebrow">Extend payroll</p>
            <p className="text-pretty text-xs" style={{ color: 'var(--muted)' }}>
              Add more pay periods at the same amount per period ({f(perStep)} {s.symbol}). The new periods are funded now.
            </p>
            <Field label="Periods to add" hint={extraSteps > 0 && !extendProblem ? `Locks ${f(extendCost)} ${s.symbol} now.` : undefined}>
              <input className="field tabular-nums" inputMode="numeric" value={extra} placeholder="e.g. 3" onChange={(ev) => setExtra(ev.target.value.replace(/\D/g, '').slice(0, 4))} />
            </Field>
            {extendProblem && extra !== '' && (
              <p className="text-xs" style={{ color: 'var(--warn)' }}>
                {extendProblem}
              </p>
            )}
            <TxButton ready={!extendProblem} onClick={extend} label="Fund extra periods" phase={tx.phase} stepLabel={tx.stepLabel} />
          </section>
        )}

        {history.length > 0 && (
          <section className="inner p-4" aria-label="History">
            <p className="eyebrow mb-2">History</p>
            <ul className="space-y-2.5">
              {history.map((l) => {
                const ts = times.data?.get(l.blockNumber)
                const released = l.eventName === 'ScheduleReleased'
                const args = l.args as { amount?: bigint; extra?: bigint; extraSteps?: number; recipient?: string }
                const amountRaw = (released ? args.amount : args.extra) ?? 0n
                return (
                  <li key={`${l.transactionHash}-${l.logIndex}`} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {released ? `Paid to ${shortAddr(args.recipient ?? s.beneficiary)}` : `Extended by ${args.extraSteps ?? 0} periods`}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                        {ts ? fmtDateTime(ts) : '...'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="font-semibold tabular-nums">
                        {released ? '' : '+'}
                        {f(amountRaw)} {s.symbol}
                      </span>
                      <a href={buildTxExplorerUrl(CHAIN_ID, l.transactionHash)} target="_blank" rel="noopener noreferrer" aria-label="View transaction" className="flex size-9 items-center justify-center rounded-lg" style={{ color: 'var(--subtle)' }}>
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </>
    )
  }

  return (
    <Sheet open={!!s} onClose={onClose} eyebrow={s ? `${KIND_META[kind].label} #${s.id.toString()}` : undefined} title={s?.memo || (s ? KIND_META[kind].label : '')}>
      {body}
    </Sheet>
  )
}
