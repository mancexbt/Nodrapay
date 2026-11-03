import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Address } from 'viem'

/** A signed-in email wallet. Kept in memory only: a reload signs you out, which keeps the tokens off disk. */
export interface EmailSession {
  email: string
  userToken: string
  encryptionKey: string
  walletId: string
  address: Address
}

interface SessionValue {
  session: EmailSession | null
  setSession: (s: EmailSession | null) => void
  signOut: () => void
  emailOpen: boolean
  openEmail: () => void
  closeEmail: () => void
}

const SessionContext = createContext<SessionValue>({ session: null, setSession: () => {}, signOut: () => {}, emailOpen: false, openEmail: () => {}, closeEmail: () => {} })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EmailSession | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const signOut = useCallback(() => setSession(null), [])
  const openEmail = useCallback(() => setEmailOpen(true), [])
  const closeEmail = useCallback(() => setEmailOpen(false), [])
  const value = useMemo(() => ({ session, setSession, signOut, emailOpen, openEmail, closeEmail }), [session, signOut, emailOpen, openEmail, closeEmail])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = () => useContext(SessionContext)
