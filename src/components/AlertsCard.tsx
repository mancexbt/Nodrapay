import { useState } from 'react'
import { BellRing } from 'lucide-react'
import { useAccount } from '@/hooks/useAccount'
import { apiPost, useServerConfig } from '@/lib/api'
import { useSession } from '@/lib/session'

type State = 'idle' | 'sending' | 'pending' | 'already' | 'error'

/** Opt in to email alerts. Needs a confirmation click in the inbox before anything is sent. */
export function AlertsCard() {
  const { address } = useAccount()
  const { session } = useSession()
  const { data } = useServerConfig()
  const [email, setEmail] = useState(session?.email ?? '')
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  if (!data?.alerts || !address) return null
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())

  const submit = async () => {
    setState('sending')
    try {
      const res = await apiPost<{ status: 'pending' | 'already' }>('/api/alerts/subscribe', { email: email.trim(), address })
      setState(res.status)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.')
      setState('error')
    }
  }

  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3" aria-label="Email alerts">
      <div className="flex min-w-0 items-center gap-2.5">
        <BellRing className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Email alerts</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {state === 'pending'
              ? 'Check your inbox and click the link to confirm.'
              : state === 'already'
                ? 'Alerts are already on for this wallet.'
                : 'Get an email when a payment unlocks, a plan is set up for you, or an escrow needs you.'}
          </p>
        </div>
      </div>
      {state !== 'pending' && state !== 'already' && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input className="field min-w-0 flex-1 sm:w-56 sm:flex-none" type="email" aria-label="Email for alerts" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={!valid || state === 'sending'} onClick={() => void submit()}>
            {state === 'sending' ? 'Sending...' : 'Turn on alerts'}
          </button>
        </div>
      )}
      {state === 'error' && (
        <p role="alert" className="w-full text-xs font-medium" style={{ color: 'var(--danger)' }}>
          {message}
        </p>
      )}
    </section>
  )
}
