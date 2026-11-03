import { ArrowRight } from 'lucide-react'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, VAULT_ADDRESS } from '@/lib/vault'
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
  { id: 'treasury', title: PLAN_BY_ID.treasury.title, body: PLAN_BY_ID.treasury.blurb },
]

const POINTS = [
  { title: 'The contract holds the money', body: 'Funds sit in a smart contract on Arc. Nobody at Nodra can move them, pause them or change the rules.' },
  { title: 'No fees, no admin', body: 'The contract has no owner, no upgrade key and no fee. It only does what each escrow or plan says.' },
  { title: 'USDC first, other tokens too', body: 'Built for USDC on Arc. Other standard ERC-20 tokens work as well.' },
  { title: 'Tested, not yet audited', body: 'The contract was reviewed and tested thoroughly, but it has not had an independent audit. Start small.' },
]

/** One About section: what Nodra is, how it works, what it can do, and what to know before trusting it. */
export function About({ onOpen }: { onOpen: (page: PageId) => void }) {
  return (
    <section id="about" className="card scroll-mt-6 space-y-8 p-6 sm:p-8" aria-label="About Nodra">
      <div className="max-w-2xl">
        <p className="eyebrow">About</p>
        <h2 className="display mt-1 text-2xl font-bold">Payments that wait for the right moment</h2>
        <p className="mt-2 text-pretty text-sm sm:text-base" style={{ color: 'var(--muted)' }}>
          Nodra lets you lock USDC for someone and decide when it is paid: when you approve the work, when a milestone is met, or when a date arrives. The same tools cover
          payroll, vesting and treasury lockups. Everything is recorded onchain, so both sides can see exactly what is held and what happens next.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="display text-lg font-bold">How it works</h3>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="inner p-4">
              <p className="eyebrow">Step {i + 1}</p>
              <h4 className="display mt-1 text-base font-semibold">{s.title}</h4>
              <p className="mt-1.5 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-3">
        <h3 className="display text-lg font-bold">What it can do</h3>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.id}>
              <button className="inner flex h-full w-full flex-col gap-1.5 p-4 text-left transition-shadow hover:shadow-lg" onClick={() => onOpen(f.id)}>
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
      </div>

      <div className="space-y-3">
        <h3 className="display text-lg font-bold">What to know</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {POINTS.map((p) => (
            <li key={p.title} className="inner p-4">
              <h4 className="display text-base font-semibold">{p.title}</h4>
              <p className="mt-1 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
                {p.body}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <a className="inline-flex min-h-11 items-center text-sm font-semibold hover:underline" style={{ color: 'var(--success)' }} href={buildAddressExplorerUrl(CHAIN_ID, VAULT_ADDRESS)} target="_blank" rel="noopener noreferrer">
        View the contract on the explorer
      </a>
    </section>
  )
}
