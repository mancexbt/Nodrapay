import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from '@/hooks/useAccount'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { DURATION_UNITS, fmtToken, type DurationUnitId } from '@/lib/vault'
import type { TxPhase } from '@/hooks/useVaultTx'

const SPRING = { type: 'spring', stiffness: 380, damping: 38 } as const

function useIsDesktop(): boolean {
  const query = '(min-width: 768px)'
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return matches
}

/** Side drawer on desktop, bottom sheet on mobile. */
export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  children: ReactNode
}) {
  const desktop = useIsDesktop()
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const hidden = desktop ? { x: '100%' } : { y: '100%' }
  const shown = desktop ? { x: 0 } : { y: 0 }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-[#00150d]/40 backdrop-blur-sm" />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl md:max-h-none md:w-[500px] md:max-w-none md:rounded-none md:rounded-l-3xl"
            style={{ background: 'var(--sheet-bg)', borderLeft: '1px solid var(--border)', boxShadow: '-24px 0 60px -30px rgba(0,21,13,0.35)' }}
            initial={hidden}
            animate={shown}
            exit={hidden}
            transition={SPRING}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="spectral h-1 shrink-0" />
            <div className="flex shrink-0 items-start justify-between px-5 pt-4">
              <div>
                {eyebrow && <p className="eyebrow">{eyebrow}</p>}
                <h2 className="display text-xl font-bold">{title}</h2>
              </div>
              <button onClick={onClose} aria-label="Close" className="-mr-2 flex size-11 items-center justify-center rounded-full" style={{ color: 'var(--muted)' }}>
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-8 pt-3">{children}</div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-pretty text-xs" style={{ color: 'var(--subtle)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

export function AmountInput({ value, onChange, label = 'Amount', symbol = 'USDC', decimals = 6 }: { value: string; onChange: (v: string) => void; label?: string; symbol?: string; decimals?: number }) {
  return (
    <div className="inner p-4">
      <span className="eyebrow">{label}</span>
      <div className="mt-1 flex items-baseline gap-2">
        <input
          inputMode="decimal"
          aria-label={label}
          value={value}
          onChange={(event) => {
            const next = event.target.value.replace(/[^0-9.]/g, '')
            if (new RegExp(`^\\d*\\.?\\d{0,${Math.min(decimals, 18)}}$`).test(next)) onChange(next)
          }}
          placeholder="0.00"
          className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
        />
        <span className="max-w-24 truncate text-sm font-medium" style={{ color: 'var(--subtle)' }}>
          {symbol}
        </span>
      </div>
    </div>
  )
}

export function DurationInput({
  value,
  unit,
  onValue,
  onUnit,
  label,
  hint,
}: {
  value: string
  unit: DurationUnitId
  onValue: (v: string) => void
  onUnit: (u: DurationUnitId) => void
  label: string
  hint?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          className="field tabular-nums"
          inputMode="numeric"
          value={value}
          onChange={(event) => onValue(event.target.value.replace(/\D/g, ''))}
          placeholder="0"
          style={{ maxWidth: '7rem' }}
        />
        <select className="field" value={unit} onChange={(event) => onUnit(event.target.value as DurationUnitId)}>
          {DURATION_UNITS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
    </Field>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inner flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && (
          <span className="block text-pretty text-xs" style={{ color: 'var(--muted)' }}>
            {hint}
          </span>
        )}
      </span>
      <span className="relative h-6 w-11 shrink-0 rounded-full transition-colors" style={{ background: checked ? 'var(--accent)' : 'var(--track-off)' }}>
        <span
          className="absolute top-0.5 size-5 rounded-full shadow transition-all"
          style={{ left: checked ? '1.375rem' : '0.125rem', background: '#fff' }}
        />
      </span>
    </button>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warn' | 'danger'; children: ReactNode }) {
  const palette = {
    neutral: { bg: 'var(--chip)', fg: 'var(--ink-2)' },
    success: { bg: 'rgba(5,185,89,0.14)', fg: 'var(--success)' },
    warn: { bg: 'rgba(240,180,41,0.18)', fg: 'var(--warn)' },
    danger: { bg: 'rgba(217,45,45,0.1)', fg: 'var(--danger)' },
  }[tone]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: palette.bg, color: palette.fg }}>
      <span className="size-1.5 rounded-full" style={{ background: palette.fg }} />
      {children}
    </span>
  )
}

export function Progress({ claimedPct, unlockedPct, height = 6 }: { claimedPct: number; unlockedPct: number; height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-full" style={{ height, background: 'var(--track)' }} aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${unlockedPct}%`, background: 'rgba(5,185,89,0.28)' }} />
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${claimedPct}%`, background: 'var(--accent)' }} />
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl p-1" style={{ background: 'var(--chip)', border: '1px solid var(--border)' }}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className="min-h-9 rounded-lg px-3.5 text-xs font-semibold transition-colors"
          style={value === o.id ? { background: '#fff', color: 'var(--ink)', boxShadow: '0 1px 3px rgba(0,21,13,0.15)' } : { color: 'var(--muted)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, sub, big = false }: { label: string; value: ReactNode; sub?: ReactNode; big?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className={`display mt-1 font-bold tabular-nums [overflow-wrap:anywhere] ${big ? 'text-3xl sm:text-4xl' : 'text-xl'}`}>{value}</p>
      {sub && (
        <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}

/** One primary action. Shows connect, in-wallet, and confirming states from real wallet and receipt status. */
export function TxButton({
  ready,
  onClick,
  label,
  phase,
  stepLabel,
  tone = 'primary',
  small = false,
}: {
  ready: boolean
  onClick: () => unknown
  label: string
  phase: TxPhase
  stepLabel?: string
  tone?: 'primary' | 'ghost' | 'danger'
  small?: boolean
}) {
  const { isConnected } = useAccount()
  const cls = `btn ${tone === 'primary' ? 'btn-primary' : tone === 'ghost' ? 'btn-ghost' : 'btn-danger'} ${small ? 'btn-sm' : 'w-full'}`

  if (!isConnected) {
    return (
      <ConnectKitButton.Custom>
        {({ show }) => (
          <button className={cls} onClick={show}>
            Connect wallet
          </button>
        )}
      </ConnectKitButton.Custom>
    )
  }

  return (
    <button
      className={cls}
      disabled={!ready || phase !== 'idle'}
      onClick={() => {
        void onClick()
      }}
    >
      {phase === 'wallet' ? (
        <>
          <Loader2 className="size-4 animate-spin" /> {stepLabel ? `${stepLabel}: confirm in wallet` : 'Confirm in wallet'}
        </>
      ) : phase === 'confirming' ? (
        <>
          <Loader2 className="size-4 animate-spin" /> {stepLabel ? `${stepLabel}: confirming` : 'Confirming'}
        </>
      ) : (
        label
      )}
    </button>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <h3 className="display text-lg font-semibold">{title}</h3>
      <p className="max-w-xs text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        {body}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Always tells the person why the main button is disabled, and what their wallet holds. */
export function ProblemNote({ problem, balance, symbol = 'USDC', decimals = 6 }: { problem: string | null; balance?: bigint; symbol?: string; decimals?: number }) {
  return (
    <div className="space-y-1.5">
      {problem && (
        <p className="flex items-start gap-1.5 text-xs font-medium" style={{ color: 'var(--warn)' }}>
          <AlertCircle className="mt-px size-3.5 shrink-0" /> <span>To continue: {problem}</span>
        </p>
      )}
      {balance === 0n && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          {symbol === 'USDC' ? 'Your wallet has no USDC. Use Get test USDC in the Arc Studio sidebar first.' : `Your wallet holds no ${symbol}.`}
        </p>
      )}
      {balance !== undefined && balance > 0n && (
        <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
          Wallet balance: {fmtToken(balance, decimals)} {symbol}
        </p>
      )}
    </div>
  )
}
