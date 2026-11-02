import { useMemo, useState } from 'react'
import { useAccount } from '@/hooks/useAccount'
import type { Address } from 'viem'
import { Plus, Trash2 } from 'lucide-react'
import { DurationInput, Field, ProblemNote, Segmented, Sheet, Toggle, TxButton } from '@/components/ui'
import { useVaultTx } from '@/hooks/useVaultTx'
import { UnlockChart } from '@/components/UnlockChart'
import { useNow, useTokenMeta } from '@/hooks/useVaultData'
import { TokenField } from '@/components/TokenField'
import {
  CHAIN_ID,
  VAULT_ADDRESS,
  durationSeconds,
  nowSeconds,
  parseTokenInput,
  USDC_ADDRESS,
  fmtToken,
  payoutVaultAbi,
  sameAddr,
  type DurationUnitId,
  type SchedParams,
} from '@/lib/vault'
import { MAX_MEMO_BYTES, memoBytes, validAddress } from '@/lib/forms'

interface Row {
  key: number
  address: string
  amount: string
}

// The contract accepts up to 100, but a batch that large uses most of a block's gas. 50 keeps a safe margin.
const MAX_RECIPIENTS = 50
let rowKey = 1
const newRow = (address = '', amount = ''): Row => ({ key: rowKey++, address, amount })

export function CreatePayroll({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount()
  const [token, setToken] = useState<string>(USDC_ADDRESS)
  const meta = useTokenMeta(token)
  const tx = useVaultTx()
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [everyValue, setEveryValue] = useState('1')
  const [everyUnit, setEveryUnit] = useState<DurationUnitId>('months')
  const [periods, setPeriods] = useState('3')
  const [cancelable, setCancelable] = useState(true)
  const [memo, setMemo] = useState('')
  const [payMode, setPayMode] = useState<'custom' | 'split'>('custom')
  const [splitTotal, setSplitTotal] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const stepSecs = durationSeconds(everyValue, everyUnit)
  const steps = /^\d+$/.test(periods) ? Number(periods) : 0

  const splitRaw = meta.ok ? parseTokenInput(splitTotal, meta.decimals) : null
  const count = BigInt(rows.length)

  // Even split: everyone gets the same whole-unit share, and the few leftover units go to the first people.
  const parsed = useMemo(
    () =>
      rows.map((row, i) => {
        let perPeriod: bigint | null
        if (payMode === 'split') {
          perPeriod = splitRaw !== null && splitRaw >= count ? splitRaw / count + (BigInt(i) < splitRaw % count ? 1n : 0n) : null
        } else {
          perPeriod = meta.ok ? parseTokenInput(row.amount, meta.decimals) : null
        }
        return { row, perPeriod, valid: validAddress(row.address) }
      }),
    [rows, meta.ok, meta.decimals, payMode, splitRaw, count],
  )
  const totals = parsed.map((p) => (p.perPeriod ? p.perPeriod * BigInt(steps || 0) : 0n))
  const grandTotal = totals.reduce((a, b) => a + b, 0n)
  const perCycle = parsed.reduce((a, p) => a + (p.perPeriod ?? 0n), 0n)

  const nowTs = useNow(5000)
  const previewSeries = useMemo<SchedParams[]>(() => {
    if (!stepSecs || steps < 1 || steps > 150 || grandTotal === 0n) return []
    return [{ total: grandTotal, start: nowTs, cliff: 0n, stepDuration: stepSecs, steps }]
  }, [stepSecs, steps, grandTotal, nowTs])

  const badAddr = parsed.findIndex((r) => !r.valid || BigInt(r.valid ? r.row.address.trim() : '0') <= 0xffffn)
  const badAmount = parsed.findIndex((r) => !r.perPeriod)
  let problem: string | null = null
  if (!meta.ok) problem = meta.loading ? 'Checking the token...' : 'Pick a valid ERC-20 token.'
  else if (badAddr >= 0) problem = `Person ${badAddr + 1} needs a valid wallet address.`
  else if (payMode === 'split' && !splitRaw) problem = 'Enter the total to split each pay period.'
  else if (payMode === 'split' && splitRaw !== null && splitRaw < count) problem = 'That total is too small to split between everyone.'
  else if (badAmount >= 0) problem = `Person ${badAmount + 1} needs a pay amount per period.`
  else if (!stepSecs) problem = 'Set how often people are paid.'
  else if (steps < 1 || steps > 4_000_000) problem = 'Enter how many pay periods to fund.'
  else if (stepSecs * BigInt(steps) > 20n * 365n * 86400n) problem = 'Payroll can run for at most 20 years.'
  else if (meta.balance !== undefined && grandTotal > meta.balance)
    problem = `The full run needs ${fmtToken(grandTotal, meta.decimals)} ${meta.symbol} but your wallet holds ${fmtToken(meta.balance, meta.decimals)}. Lower the pay amounts or the number of periods.`
  else if (meta.balance !== undefined && grandTotal === meta.balance && sameAddr(meta.address, USDC_ADDRESS))
    problem = 'Leave a little USDC in your wallet to pay the network fee.'
  else if (memoBytes(memo) > MAX_MEMO_BYTES) problem = 'The note is too long.'

  const updateRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const importPaste = () => {
    const imported = pasteText
      .split('\n')
      .map((line) => line.split(/[,\s;]+/).filter(Boolean))
      .filter((parts) => (payMode === 'split' ? parts.length >= 1 : parts.length >= 2))
      .map(([addr, amt]) => newRow(addr, payMode === 'split' ? '' : (amt ?? '')))
      .slice(0, MAX_RECIPIENTS)
    if (imported.length) setRows(imported)
    setPasteText('')
    setPasteOpen(false)
  }

  const submit = async () => {
    if (problem || !stepSecs) return
    const beneficiaries = parsed.map((p) => p.row.address.trim() as Address)
    const ok = await tx.execute(
      [
        tx.approveStep(meta.address, grandTotal, meta.symbol),
        {
          label: 'Fund payroll',
          send: () =>
            tx.writeContractAsync({
              address: VAULT_ADDRESS,
              abi: payoutVaultAbi,
              functionName: 'createPayrollBatch',
              args: [meta.address, beneficiaries, totals, cancelable, nowSeconds(), stepSecs, steps, memo.trim()],
              chainId: CHAIN_ID,
            }),
        },
      ],
      'Payroll funded.',
    )
    if (ok) {
      setRows([newRow()])
      setMemo('')
      onClose()
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Fund payroll">
      <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        Lock the full run up front. Each person is paid their amount once per period, and anyone can trigger a payment when it is due.
      </p>

      <TokenField label="Token" value={token} onChange={setToken} meta={meta} required={false} />

      <div className="space-y-3">
        <Segmented
          label="How to set pay"
          value={payMode}
          onChange={setPayMode}
          options={[
            { id: 'custom', label: 'Custom amounts' },
            { id: 'split', label: 'Split evenly' },
          ]}
        />
        {payMode === 'split' && (
          <Field
            label={`Total to split each pay period (${meta.ok ? meta.symbol : 'token'})`}
            hint={
              splitRaw !== null && splitRaw >= count
                ? `Each of the ${rows.length} ${rows.length === 1 ? 'person gets' : 'people get'} about ${fmtToken(splitRaw / count, meta.decimals)} ${meta.symbol} per period.${splitRaw % count > 0n ? ' The few leftover units go to the first people.' : ''}`
                : 'Enter one amount and it is divided equally between everyone below.'
            }
          >
            <input
              className="field tabular-nums"
              inputMode="decimal"
              value={splitTotal}
              placeholder="0.00"
              onChange={(e) => new RegExp(`^\\d*\\.?\\d{0,${Math.min(meta.decimals, 18)}}$`).test(e.target.value) && setSplitTotal(e.target.value)}
            />
          </Field>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
            Team ({rows.length} of {MAX_RECIPIENTS} max)
          </span>
          <div className="flex items-center gap-3">
            {address && (
              <button
                className="min-h-11 px-1 text-xs font-semibold"
                style={{ color: 'var(--success)' }}
                onClick={() => setRows((rs) => (rs.length === 1 && !rs[0].address && !rs[0].amount ? [newRow(address)] : [...rs, newRow(address)]))}
              >
                Add my wallet
              </button>
            )}
            <button className="min-h-11 px-1 text-xs font-semibold" style={{ color: 'var(--success)' }} onClick={() => setPasteOpen((v) => !v)}>
              {pasteOpen ? 'Hide paste' : 'Paste a list'}
            </button>
          </div>
        </div>
        {pasteOpen && (
          <div className="inner space-y-2 p-3">
            <textarea
              className="field mono min-h-28 py-2"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={payMode === 'split' ? '0xabc...\n0xdef...' : '0xabc..., 2500\n0xdef..., 3100'}
              spellCheck={false}
            />
            <button className="btn btn-ghost btn-sm" onClick={importPaste}>
              Replace rows with this list
            </button>
          </div>
        )}
        {rows.map((row, i) => (
          <div key={row.key} className="flex items-center gap-2">
            <input
              className="field mono"
              aria-label={`Recipient ${i + 1}`}
              value={row.address}
              onChange={(e) => updateRow(row.key, { address: e.target.value })}
              placeholder="0x..."
              spellCheck={false}
            />
            {payMode === 'split' ? (
              <div
                className="inner flex min-h-11 w-[6.5rem] shrink-0 items-center justify-end px-3 text-sm tabular-nums"
                aria-label={`Share per period ${i + 1}`}
                style={{ color: parsed[i]?.perPeriod ? 'var(--ink)' : 'var(--subtle)' }}
              >
                {parsed[i]?.perPeriod ? fmtToken(parsed[i].perPeriod ?? 0n, meta.decimals) : '-'}
              </div>
            ) : (
              <input
                className="field tabular-nums"
                aria-label={`Pay per period ${i + 1}`}
                inputMode="decimal"
                style={{ maxWidth: '6.5rem' }}
                value={row.amount}
                onChange={(e) => new RegExp(`^\\d*\\.?\\d{0,${Math.min(meta.decimals, 18)}}$`).test(e.target.value) && updateRow(row.key, { amount: e.target.value })}
                placeholder={meta.symbol}
              />
            )}
            <button
              aria-label="Remove recipient"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-30"
              style={{ color: 'var(--muted)' }}
              disabled={rows.length === 1}
              onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <button
          className="btn btn-ghost btn-sm w-full"
          disabled={rows.length >= MAX_RECIPIENTS}
          onClick={() => setRows((rs) => [...rs, newRow()])}
        >
          <Plus className="size-4" /> Add person
        </button>
      </div>

      <DurationInput label="Paid every" value={everyValue} unit={everyUnit} onValue={setEveryValue} onUnit={setEveryUnit} hint="The first payment unlocks after one full period." />
      <Field label="Number of pay periods">
        <input className="field tabular-nums" inputMode="numeric" value={periods} onChange={(e) => setPeriods(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <Toggle
        checked={cancelable}
        onChange={setCancelable}
        label="Cancelable"
        hint={cancelable ? 'You can stop a person\'s pay. Anything already due stays claimable.' : 'Locked in for the whole run.'}
      />
      <Field label="Note (optional)">
        <input className="field" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Core team, 2026" maxLength={140} />
      </Field>

      {previewSeries.length > 0 && (
        <div className="inner p-3">
          <p className="eyebrow mb-1 px-1">Payout preview (whole team)</p>
          <UnlockChart series={previewSeries} now={nowTs} height={170} decimals={meta.decimals} label="Preview of payroll unlocks" />
        </div>
      )}
      <div className="inner space-y-1 p-4 text-sm tabular-nums">
        <div className="flex justify-between">
          <span style={{ color: 'var(--muted)' }}>Per pay period</span>
          <span className="font-semibold">{fmtToken(perCycle, meta.decimals)} {meta.symbol}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--muted)' }}>Locked now</span>
          <span className="font-semibold">{fmtToken(grandTotal, meta.decimals)} {meta.symbol}</span>
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <ProblemNote problem={problem} balance={meta.balance} symbol={meta.symbol} decimals={meta.decimals} />
        <TxButton ready={!problem} onClick={submit} label="Lock funds and start payroll" phase={tx.phase} stepLabel={tx.stepLabel} />
      </div>
    </Sheet>
  )
}
