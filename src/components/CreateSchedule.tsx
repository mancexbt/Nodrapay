import { NETWORK_NAME } from '@/lib/network'
import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import type { Address } from 'viem'
import { AmountInput, DurationInput, Field, ProblemNote, Sheet, Toggle, TxButton } from '@/components/ui'
import { TokenField } from '@/components/TokenField'
import { UnlockChart } from '@/components/UnlockChart'
import { useVaultTx } from '@/hooks/useVaultTx'
import { useNow, useTokenMeta } from '@/hooks/useVaultData'
import type { PlanPage } from '@/lib/plans'
import {
  CHAIN_ID,
  USDC_ADDRESS,
  VAULT_ADDRESS,
  durationSeconds,
  fmtDateTime,
  nowSeconds,
  parseTokenInput,
  payoutVaultAbi,
  type DurationUnitId,
  type SchedParams,
} from '@/lib/vault'
import { MAX_MEMO_BYTES, memoBytes, parseLocalInput, toLocalInput, validAddress } from '@/lib/forms'

const MAX_VEST_SECONDS = 20n * 365n * 86400n

/** One create form for every single-recipient plan: payouts, vesting, grants, claims and all lockups. */
export function CreateSchedule({ plan, open, onClose }: { plan: PlanPage; open: boolean; onClose: () => void }) {
  const { address } = useAccount()
  const cfg = plan.form
  const tx = useVaultTx()
  const [token, setToken] = useState<string>(cfg.tokenRequired ? '' : USDC_ADDRESS)
  const meta = useTokenMeta(token)
  const [beneficiary, setBeneficiary] = useState(cfg.defaultSelf && address ? address : '')
  const [amount, setAmount] = useState('')
  const [unlockAt, setUnlockAt] = useState(() => toLocalInput(Date.now() + (cfg.lockup ? 7 * 86400_000 : 3600_000)))
  const [startAt, setStartAt] = useState(() => toLocalInput(Date.now()))
  const [cliffValue, setCliffValue] = useState('')
  const [cliffUnit, setCliffUnit] = useState<DurationUnitId>('months')
  const [durValue, setDurValue] = useState('')
  const [durUnit, setDurUnit] = useState<DurationUnitId>('months')
  const [cancelable, setCancelable] = useState(cfg.defaultCancelable)
  const [memo, setMemo] = useState('')

  const mode = cfg.mode
  const amountRaw = meta.ok ? parseTokenInput(amount, meta.decimals) : null
  const unlockTs = parseLocalInput(unlockAt)
  const startTs = parseLocalInput(startAt)
  const durSecs = durationSeconds(durValue, durUnit)
  const cliffSecs = cliffValue === '' ? 0n : durationSeconds(cliffValue, cliffUnit)

  const nowTs = useNow(5000)
  const previewSeries = useMemo<SchedParams[]>(() => {
    if (!amountRaw) return []
    if (mode === 'vesting') {
      if (!startTs || !durSecs || cliffSecs === null || cliffSecs > durSecs || durSecs > MAX_VEST_SECONDS) return []
      return [{ total: amountRaw, start: startTs, cliff: cliffSecs, stepDuration: 1n, steps: Number(durSecs) }]
    }
    if (mode === 'point') {
      if (!unlockTs || unlockTs <= nowTs) return []
      return [{ total: amountRaw, start: nowTs, cliff: 0n, stepDuration: unlockTs - nowTs, steps: 1 }]
    }
    return []
  }, [amountRaw, mode, startTs, durSecs, cliffSecs, unlockTs, nowTs])

  let problem: string | null = null
  if (!meta.valid) problem = cfg.tokenRequired ? 'Paste the token address.' : 'Pick a token.'
  else if (meta.loading) problem = 'Checking the token...'
  else if (!meta.ok) problem = `That address is not an ERC-20 token on ${NETWORK_NAME}.`
  else if (!validAddress(beneficiary)) problem = `Enter the ${cfg.recipientLabel.toLowerCase()} address.`
  else if (BigInt(beneficiary.trim()) <= 0xffffn) problem = 'That address is reserved and cannot receive payouts.'
  else if (!amountRaw) problem = 'Enter an amount.'
  else if (meta.balance !== undefined && amountRaw > meta.balance) problem = `Your ${meta.symbol} balance is too low.`
  else if (memoBytes(memo) > MAX_MEMO_BYTES) problem = 'The note is too long.'
  else if (mode === 'point' && (!unlockTs || unlockTs <= nowSeconds() + 60n)) problem = 'Pick an unlock time in the future.'
  else if (mode === 'vesting' && !startTs) problem = 'Pick a start date.'
  else if (mode === 'vesting' && startTs && startTs < nowSeconds() - 80000n) problem = 'The start can be at most about a day in the past.'
  else if (mode === 'vesting' && !durSecs) problem = 'Enter how long it unlocks for.'
  else if (mode === 'vesting' && durSecs && durSecs > MAX_VEST_SECONDS) problem = 'The unlock period can be at most 20 years.'
  else if (mode === 'vesting' && cliffSecs === null) problem = 'The cliff must be a whole number.'
  else if (mode === 'vesting' && durSecs && cliffSecs !== null && cliffSecs > durSecs) problem = 'The cliff cannot be longer than the unlock period.'

  const submit = async () => {
    if (problem || !amountRaw) return
    const start = nowSeconds()
    let timing: readonly [bigint, bigint, bigint, number]
    if (mode === 'vesting' && startTs && durSecs && cliffSecs !== null) timing = [startTs, cliffSecs, 1n, Number(durSecs)]
    else if (mode === 'point' && unlockTs) timing = [start, 0n, unlockTs - start, 1]
    else if (mode === 'instant') timing = [start, 0n, 1n, 1]
    else return
    const [tStart, tCliff, tStep, tSteps] = timing

    const ok = await tx.execute(
      [
        tx.approveStep(meta.address, amountRaw, meta.symbol),
        {
          label: plan.cta,
          send: () =>
            tx.writeContractAsync({
              address: VAULT_ADDRESS,
              abi: payoutVaultAbi,
              functionName: 'createSchedule',
              args: [meta.address, beneficiary.trim() as Address, plan.kind, cfg.lockup ? false : cancelable, amountRaw, tStart, tCliff, tStep, tSteps, memo.trim()],
              chainId: CHAIN_ID,
            }),
        },
      ],
      cfg.success,
    )
    if (ok) onClose()
  }

  const applyPreset = (p: (typeof cfg.presets)[number]) => {
    setCliffValue(p.cliff[0])
    setCliffUnit(p.cliff[1])
    setDurValue(p.duration[0])
    setDurUnit(p.duration[1])
  }

  const fullyDone = startTs && durSecs ? fmtDateTime(startTs + durSecs) : null
  const cliffEnds = startTs && cliffSecs ? fmtDateTime(startTs + cliffSecs) : null

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Create" title={cfg.title}>
      <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        {cfg.intro}
      </p>
      <TokenField label={cfg.tokenLabel} value={token} onChange={setToken} meta={meta} hint={cfg.tokenHint} required={cfg.tokenRequired} />
      <AmountInput value={amount} onChange={setAmount} label="Amount" symbol={meta.ok ? meta.symbol : 'TOKEN'} decimals={meta.decimals} />
      <Field label={cfg.recipientLabel}>
        <div className="space-y-2">
          <input className="field mono" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="0x..." spellCheck={false} />
          {address && (
            <button type="button" className="inline-flex min-h-11 items-center text-xs font-semibold" style={{ color: 'var(--success)' }} onClick={() => setBeneficiary(address)}>
              Use my wallet
            </button>
          )}
        </div>
      </Field>

      {mode === 'point' && (
        <Field label="Unlocks at">
          <input className="field" type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} />
        </Field>
      )}
      {mode === 'vesting' && (
        <>
          {cfg.presets.length > 0 && (
            <div>
              <span className="eyebrow mb-1.5 block">Quick presets</span>
              <div className="flex flex-wrap gap-2">
                {cfg.presets.map((p) => (
                  <button key={p.label} type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset(p)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Starts">
            <input className="field" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <DurationInput label="Unlocks over" value={durValue} unit={durUnit} onValue={setDurValue} onUnit={setDurUnit} hint={fullyDone ? `Fully unlocked ${fullyDone}.` : undefined} />
          <DurationInput
            label="Cliff (optional)"
            value={cliffValue}
            unit={cliffUnit}
            onValue={setCliffValue}
            onUnit={setCliffUnit}
            hint={cliffEnds ? `Nothing unlocks before ${cliffEnds}.` : 'Nothing unlocks until the cliff ends. Leave empty for none.'}
          />
        </>
      )}
      {mode === 'instant' && (
        <p className="inner p-3 text-xs" style={{ color: 'var(--muted)' }}>
          The full amount becomes claimable as soon as the transaction confirms.
        </p>
      )}

      {cfg.lockup ? (
        <p className="inner p-3 text-xs" style={{ color: 'var(--muted)' }}>
          This is a lockup: it cannot be cancelled by anyone once created.
        </p>
      ) : (
        <Toggle
          checked={cancelable}
          onChange={setCancelable}
          label={plan.kind === 4 ? 'Reclaimable' : 'Cancelable'}
          hint={cancelable ? 'You can cancel. Whatever has unlocked stays claimable; the rest returns to you.' : 'Locked in. Neither side can undo it.'}
        />
      )}
      <Field label="Note (optional)">
        <input className="field" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What is this for?" maxLength={140} />
      </Field>
      {previewSeries.length > 0 && (
        <div className="inner p-3">
          <p className="eyebrow mb-1 px-1">Unlock preview</p>
          <UnlockChart series={previewSeries} now={nowTs} height={170} decimals={meta.decimals} label="Preview of the unlock schedule" />
        </div>
      )}
      <div className="space-y-2 pt-1">
        <ProblemNote problem={problem} balance={meta.balance} symbol={meta.symbol} decimals={meta.decimals} />
        <TxButton ready={!problem} onClick={submit} label={cfg.cta} phase={tx.phase} stepLabel={tx.stepLabel} />
      </div>
    </Sheet>
  )
}
