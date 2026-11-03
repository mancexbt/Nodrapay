import { useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { toast } from 'sonner'
import type { Address } from 'viem'
import { Field, Sheet } from '@/components/ui'
import { ApiRequestError, circleCall, useEmailWalletsEnabled } from '@/lib/api'
import { runChallenge, requestEmailCode, verifyEmailCode, type LoginResult } from '@/lib/circleSdk'
import { useSession } from '@/lib/session'

interface CircleWallet {
  id: string
  address: string
  blockchain: string
}

const NETWORK_WALLET = 'ARC-TESTNET'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Circle's SDK throws plain objects ({ code, message }) as well as Errors, so read both shapes. */
function errorText(e: unknown): string {
  console.error('[email sign-up]', e)
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const { message, code } = e as { message?: unknown; code?: string | number }
    if (typeof message === 'string' && message) return code !== undefined ? `${message} (code ${code})` : message
    if (code !== undefined) return `Circle returned code ${code}.`
  }
  return typeof e === 'string' && e ? e : 'Something went wrong. Please try again.'
}

async function listWallets(login: LoginResult): Promise<CircleWallet[]> {
  const { wallets } = await circleCall<{ wallets: CircleWallet[] }>('listWallets', { userToken: login.userToken })
  return wallets ?? []
}

/** Email sign-up: Circle emails a one-time code, then creates a PIN-protected wallet for the person. */
export function EmailSignIn({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setSession } = useSession()
  const available = useEmailWalletsEnabled()
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code' | 'wallet'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    try {
      await requestEmailCode(email.trim())
      setStep('code')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const finish = async (login: LoginResult) => {
    setStep('wallet')
    let wallets = await listWallets(login)
    if (wallets.length === 0) {
      try {
        const { challengeId } = await circleCall<{ challengeId: string }>('initializeUser', { userToken: login.userToken })
        await runChallenge(login, challengeId)
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.code === 155106)) throw e
      }
      for (let i = 0; i < 6 && wallets.length === 0; i++) {
        await wait(2000)
        wallets = await listWallets(login)
      }
    }
    const wallet = wallets.find((w) => w.blockchain === NETWORK_WALLET) ?? wallets[0]
    if (!wallet) throw new Error('Your wallet is still being created. Wait a moment and sign in again.')
    setSession({ email: email.trim(), userToken: login.userToken, encryptionKey: login.encryptionKey, walletId: wallet.id, address: wallet.address as Address })
    toast.success('Signed in. Your wallet is ready.')
    setStep('email')
    onClose()
  }

  const enterCode = async () => {
    setBusy(true)
    setError(null)
    try {
      await finish(await verifyEmailCode())
    } catch (e) {
      setError(errorText(e))
      setStep('code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Account" title="Sign up with email">
      <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        No wallet extension needed. Circle emails you a one-time code, then sets up a wallet that only you control with a PIN you choose.
      </p>

      {!available && (
        <div className="inner space-y-1.5 p-4" role="status">
          <p className="text-sm font-semibold">Email sign-up isn&apos;t switched on for this site yet.</p>
          <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            You can still connect a wallet to use Nodra today. Email sign-up will appear here once it is set up.
          </p>
        </div>
      )}

      {available && step === 'email' && (
        <>
          <Field label="Email address">
            <input className="field" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <button className="btn btn-primary w-full" disabled={!validEmail || busy} onClick={() => void sendCode()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Email me a code
          </button>
        </>
      )}

      {available && step === 'code' && (
        <div className="space-y-3">
          <p className="inner p-3 text-sm">
            A code is on its way to <span className="font-semibold">{email.trim()}</span>. Click below to enter it in Circle&apos;s secure window.
          </p>
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => void enterCode()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Enter my code
          </button>
          <button className="btn btn-ghost w-full" disabled={busy} onClick={() => setStep('email')}>
            Use a different email
          </button>
        </div>
      )}

      {available && step === 'wallet' && (
        <p className="inner flex items-center gap-2 p-3 text-sm">
          <Loader2 className="size-4 animate-spin" /> Setting up your wallet. If a Circle window opens, choose your PIN there.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {available && (
      <p className="text-pretty text-xs" style={{ color: 'var(--subtle)' }}>
        Nodra and Circle cannot recover your PIN or wallet if you lose access to your email and PIN. This wallet lives on Arc Testnet, and you fund it by sending test USDC to its address.
      </p>
      )}
    </Sheet>
  )
}
