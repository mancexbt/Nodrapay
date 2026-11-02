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
}

const SessionContext = createContext<SessionValue>({ session: null, setSession: () => {}, signOut: () => {} })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EmailSession | null>(null)
  const signOut = useCallback(() => setSession(null), [])
  const value = useMemo(() => ({ session, setSession, signOut }), [session, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = () => useContext(SessionContext)
