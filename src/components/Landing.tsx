import { ArrowRight } from 'lucide-react'
import { PLAN_BY_ID, type PageId } from '@/lib/plans'

const STEPS = [
  { title: 'Lock', body: 'Fund an escrow or plan with USDC. The contract holds the money, not a person or a company.' },
  { title: 'Set the conditions', body: 'Name milestones, add an arbiter, or choose a schedule with an optional cliff.' },
  { title: 'Release or claim', body: 'Release milestones as work is approved. If nobody acts after the deadline, the recipient can claim.' },
]

const FEATURES: { id: PageId; title: string; body: string }[] = [
  { id: 'escrow', title: 'Escrow', body: 'Hold funds until work is approved, with named milestones and an optional arbiter.' },
  { id: 'scheduled', title: PLAN_BY_ID.scheduled.title, body: PLAN_BY_ID.scheduled.blurb },
  { id: 'payroll', title: PLAN_BY_ID.payroll.title, body: PLAN_BY_ID.payroll.blurb },
  { id: 'vesting', title: PLAN_BY_ID.vesting.title, body: PLAN_BY_ID.vesting.blurb },
  { id: 'claims', title: PLAN_BY_ID.claims.title, body: PLAN_BY_ID.claims.blurb },
  { id: 'timelock', title: PLAN_BY_ID.timelock.title, body: PLAN_BY_ID.timelock.blurb },
]

/** Front-page explainer shown before a wallet is connected. */
export function Landing({ onOpen }: { onOpen: (page: PageId) => void }) {
  return (
    <>
      <section className="space-y-3" aria-label="How it works">
        <h2 className="display text-xl font-bold">How it works</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card p-5">
              <p className="eyebrow">Step {i + 1}</p>
              <h3 className="display mt-1 text-base font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3" aria-label="What you can build">
        <h2 className="display text-xl font-bold">What you can do</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.id}>
              <button className="card group flex h-full w-full flex-col gap-1.5 p-5 text-left transition-shadow hover:shadow-lg" onClick={() => onOpen(f.id)}>
                <span className="display text-base font-semibold">{f.title}</span>
                <span className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
                  {f.body}
                </span>
                <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                  Open <ArrowRight className="size-3.5" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
