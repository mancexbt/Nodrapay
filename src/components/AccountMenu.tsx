import { useState } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import { CopyButton } from '@/components/table'
import { useSession } from '@/lib/session'
import { shortAddr } from '@/lib/vault'

/** Header chip for a signed-in email wallet. */
export function AccountMenu() {
  const { session, signOut } = useSession()
  const [open, setOpen] = useState(false)
  if (!session) return null
  return (
    <div className="relative">
      <button className="btn btn-ghost btn-sm max-w-[14rem]" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="truncate">{session.email}</span> <ChevronDown className="size-4 shrink-0" />
      </button>
      {open && (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="card absolute right-0 z-40 mt-2 w-72 space-y-3 p-4" style={{ background: 'var(--sheet-bg)', boxShadow: '0 18px 40px -16px rgba(0,21,13,0.3)' }}>
            <div>
              <p className="eyebrow">Your wallet (Arc Testnet)</p>
              <p className="mono mt-1 flex items-center gap-1 break-all text-xs">
                {shortAddr(session.address)} <CopyButton value={session.address} label="Copy wallet address" />
              </p>
              <p className="mt-1.5 text-pretty text-xs" style={{ color: 'var(--muted)' }}>
                Send test USDC to this address to fund payments and network fees.
              </p>
            </div>
            <button
              role="menuitem"
              className="btn btn-ghost btn-sm w-full"
              onClick={() => {
                setOpen(false)
                signOut()
              }}
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
