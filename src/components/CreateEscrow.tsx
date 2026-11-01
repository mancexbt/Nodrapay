import { useState } from 'react'
import { useAccount } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { Plus, Trash2 } from 'lucide-react'
import { Field, AmountInput, ProblemNote, Segmented, Sheet, Toggle, TxButton } from '@/components/ui'
import { useVaultTx } from '@/hooks/useVaultTx'
import { useTokenMeta } from '@/hooks/useVaultData'
import { TokenField } from '@/components/TokenField'
import { CHAIN_ID, USDC_ADDRESS, VAULT_ADDRESS, fmtToken, nowSeconds, parseTokenInput, payoutVaultAbi, sameAddr } from '@/lib/vault'
import { MAX_MEMO_BYTES, memoBytes, parseLocalInput, toLocalInput, validAddress } from '@/lib/forms'

interface MilestoneRow {
  key: number
  title: string
  amount: string
}
const MAX_MILESTONES = 20
let msKey = 1
const newMilestone = (title = '', amount = ''): MilestoneRow => ({ key: msKey++, title, amount })

export function CreateEscrow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount()
  const tx = useVaultTx()
  const [token, setToken] = useState<string>(USDC_ADDRESS)
  const meta = useTokenMeta(token)
  const [beneficiary, setBeneficiary] = useState('')
  const [arbiter, setArbiter] = useState('')
  const [amount, setAmount] = useState('')
  const [deadline, setDeadline] = useState(() => toLocalInput(Date.now() + 7 * 86400_000))
  const [memo, setMemo] = useState('')
  const [useMilestones, setUseMilestones] = useState(false)
  const [rows, setRows] = useState<MilestoneRow[]>(() => [newMilestone('', ''), newMilestone('', '')])

  const [splitMode, setSplitMode] = useState<'custom' | 'even'>('custom')
  const [splitTotal, setSplitTotal] = useState('')
  const splitRaw = meta.ok ? parseTokenInput(splitTotal, meta.decimals) : null
  // Even split: everyone gets the same share and the leftover smallest units go to the first milestones.
  const evenShare = (i: number): bigint | null => {
    if (!splitRaw || splitRaw < BigInt(rows.length)) return null
    const n = BigInt(rows.length)
    return splitRaw / n + (BigInt(i) < splitRaw % n ? 1n : 0n)
  }
  const parsedRows = rows.map((r, i) => ({ row: r, amount: splitMode === 'even' ? evenShare(i) : meta.ok ? parseTokenInput(r.amount, meta.decimals) : null }))
  const milestoneTotal = parsedRows.reduce((sum, r) => sum + (r.amount ?? 0n), 0n)
  const updateRow = (key: number, patch: Partial<MilestoneRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const amountRaw = useMilestones ? (milestoneTotal > 0n ? milestoneTotal : null) : meta.ok ? parseTokenInput(amount, meta.decimals) : null
  const deadlineTs = parseLocalInput(deadline)
  const arbiterSet = arbiter.trim() !== ''

  let problem: string | null = null
  if (!meta.ok) problem = meta.loading ? 'Checking the token...' : 'Pick a valid ERC-20 token.'
  else if (!validAddress(beneficiary)) problem = 'Enter the recipient wallet address.'
  else if (sameAddr(beneficiary, address)) problem = 'The recipient must be a different wallet.'
  else if (arbiterSet && !validAddress(arbiter)) problem = 'The arbiter address is not valid.'
  else if (arbiterSet && (sameAddr(arbiter, address) || sameAddr(arbiter, beneficiary))) problem = 'The arbiter must be someone else.'
  else if (useMilestones && parsedRows.some((r) => !r.row.title.trim())) problem = 'Give every milestone a name.'
  else if (useMilestones && parsedRows.some((r) => memoBytes(r.row.title) > 80)) problem = 'A milestone name is too long.'
  else if (useMilestones && splitMode === 'even' && !splitRaw) problem = 'Enter the total to split between the milestones.'
  else if (useMilestones && splitMode === 'even' && splitRaw && splitRaw < BigInt(rows.length)) problem = 'The total is too small to split between that many milestones.'
  else if (useMilestones && parsedRows.some((r) => !r.amount)) problem = 'Every milestone needs an amount.'
  else if (!amountRaw) problem = 'Enter an amount.'
  else if (meta.balance !== undefined && amountRaw > meta.balance) problem = `Your ${meta.symbol} balance is too low.`
  else if (!deadlineTs || deadlineTs <= nowSeconds() + 60n) problem = 'Pick a deadline in the future.'
  else if (memoBytes(memo) > MAX_MEMO_BYTES) problem = 'The note is too long.'

  const submit = async () => {
    if (problem || !amountRaw || !deadlineTs) return
    const ok = await tx.execute(
      [
        tx.approveStep(meta.address, amountRaw, meta.symbol),
        {
          label: 'Lock funds',
          send: () =>
            tx.writeContractAsync({
              address: VAULT_ADDRESS,
              abi: payoutVaultAbi,
              functionName: 'createEscrow',
              args: [meta.address, beneficiary.trim() as Address, arbiterSet ? (arbiter.trim() as Address) : zeroAddress, amountRaw, deadlineTs, memo.trim(), useMilestones ? parsedRows.map((r) => ({ title: r.row.title.trim(), amount: r.amount ?? 0n })) : []],
              chainId: CHAIN_ID,
            }),
        },
      ],
      'Escrow funded.',
    )
    if (ok) {
      setBeneficiary('')
      setArbiter('')
      setAmount('')
      setSplitTotal('')
      setMemo('')
      onClose()
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New escrow">
      <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        Lock tokens for someone and release them as the work is approved. Add milestones to pay in named steps, and an arbiter if you want a neutral third party to decide.
      </p>
      <TokenField label="Token" value={token} onChange={setToken} meta={meta} required={false} />
      <Toggle checked={useMilestones} onChange={setUseMilestones} label="Pay in milestones" hint={useMilestones ? 'Each milestone is released on its own. Set each amount yourself, or split one total evenly.' : 'Turn on to split the payment into named steps.'} />
      {useMilestones ? (
        <div className="space-y-2">
          <Segmented
            label="How to set milestone amounts"
            value={splitMode}
            onChange={setSplitMode}
            options={[
              { id: 'custom', label: 'Custom amounts' },
              { id: 'even', label: 'Split evenly' },
            ]}
          />
          {splitMode === 'even' && (
            <AmountInput value={splitTotal} onChange={setSplitTotal} label="Total to split" symbol={meta.ok ? meta.symbol : 'TOKEN'} decimals={meta.decimals} />
          )}
          {rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2">
              <input className="field" aria-label={`Milestone ${i + 1} name`} placeholder={`Milestone ${i + 1}`} value={r.title} maxLength={80} onChange={(e) => updateRow(r.key, { title: e.target.value })} />
              {splitMode === 'even' ? (
                <div className="field tabular-nums flex items-center justify-end" style={{ maxWidth: '6.5rem', color: 'var(--muted)' }} aria-label={`Milestone ${i + 1} share`}>
                  {parsedRows[i].amount ? fmtToken(parsedRows[i].amount, meta.decimals) : '-'}
                </div>
              ) : (
                <input
                  className="field tabular-nums"
                  aria-label={`Milestone ${i + 1} amount`}
                  inputMode="decimal"
                  style={{ maxWidth: '6.5rem' }}
                  placeholder={meta.symbol}
                  value={r.amount}
                  onChange={(e) => new RegExp(`^\\d*\\.?\\d{0,${Math.min(meta.decimals, 18)}}$`).test(e.target.value) && updateRow(r.key, { amount: e.target.value })}
                />
              )}
              <button
                aria-label="Remove milestone"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-30"
                style={{ color: 'var(--muted)' }}
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm w-full" disabled={rows.length >= MAX_MILESTONES} onClick={() => setRows((rs) => [...rs, newMilestone()])}>
            <Plus className="size-4" /> Add milestone
          </button>
          {splitMode === 'even' && splitRaw !== null && splitRaw >= BigInt(rows.length) && (
            <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              {rows.length} milestones of about {fmtToken(splitRaw / BigInt(rows.length), meta.decimals)} {meta.symbol} each.
            </p>
          )}
          <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            Total to lock: {fmtToken(milestoneTotal, meta.decimals)} {meta.ok ? meta.symbol : ''}
          </p>
        </div>
      ) : (
        <AmountInput value={amount} onChange={setAmount} label="Amount to lock" symbol={meta.ok ? meta.symbol : 'TOKEN'} decimals={meta.decimals} />
      )}
      <Field label="Recipient" hint="The wallet that gets paid. It must be a different wallet from yours, so use a second address to try it out.">
        <input className="field mono" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="0x..." spellCheck={false} />
      </Field>
      <Field label="Arbiter (optional)" hint="A neutral third party who can release or refund. Leave empty and only you decide.">
        <input className="field mono" value={arbiter} onChange={(e) => setArbiter(e.target.value)} placeholder="0x..." spellCheck={false} />
      </Field>
      <Field
        label="Deadline"
        hint={arbiterSet ? 'After this date plus 7 days you can take back what is left. If you do nothing for 7 more days, the recipient can claim it.' : 'After this date you can take back what is left. If you do nothing for 7 more days, the recipient can claim it.'}
      >
        <input className="field" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </Field>
      <Field label="Note (optional)">
        <input className="field" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Logo design, milestone 1 of 3" maxLength={140} />
      </Field>
      <div className="space-y-2 pt-1">
        <ProblemNote problem={problem} balance={meta.balance} symbol={meta.symbol} decimals={meta.decimals} />
        <TxButton ready={!problem} onClick={submit} label="Lock funds in escrow" phase={tx.phase} stepLabel={tx.stepLabel} />
      </div>
    </Sheet>
  )
}
