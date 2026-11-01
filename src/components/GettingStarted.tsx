import { Check } from 'lucide-react'
import type { VaultData } from '@/hooks/useVaultData'

/** Slim checklist driven by real wallet and contract state. Hides itself once every step is done. */
export function GettingStarted({ balance, data, onCreate }: { balance?: bigint; data?: VaultData; onCreate: () => void }) {
  const hasFunds = (balance ?? 0n) > 0n
  const hasPlan = (data?.escrows.length ?? 0) + (data?.schedules.length ?? 0) > 0
  const hasPayment = (data?.escrows ?? []).some((e) => e.released > 0n) || (data?.schedules ?? []).some((s) => s.claimed > 0n)
  const steps = [
    { done: hasFunds, title: 'Fund your wallet' },
    { done: hasPlan, title: 'Create a plan' },
    { done: hasPayment, title: 'Complete a payment' },
  ]
  if (steps.every((s) => s.done)) return null
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <ol className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-center gap-2 text-sm font-medium">
            <span
              className="flex size-5 items-center justify-center rounded-full text-[11px] font-bold"
              style={step.done ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--chip)', color: 'var(--ink-2)' }}
            >
              {step.done ? <Check className="size-3" /> : i + 1}
            </span>
            <span style={{ color: step.done ? 'var(--subtle)' : 'var(--ink)' }}>{step.title}</span>
          </li>
        ))}
      </ol>
      {!hasFunds ? (
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          Use Get test USDC in the Arc Studio sidebar.
        </span>
      ) : !hasPlan ? (
        <button className="btn btn-primary btn-sm" onClick={onCreate}>
          Create a plan
        </button>
      ) : null}
    </section>
  )
}
