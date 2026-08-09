import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSyncConfigured, supabase } from '../lib/supabase'
import { clearLocalData, startSync, stopSync } from '../sync/sync'

export interface AuthResult {
  error?: string
  /** Set when a new account was created but Supabase is holding it pending an
   *  emailed confirmation, so no session was issued. */
  needsConfirmation?: boolean
}

interface AuthValue {
  /** `loading` until the persisted session has been read. */
  loading: boolean
  session: Session | null
  email: string | null
  /** False when no Supabase credentials are configured — the app then runs as
   *  a local-only tracker and never shows the sign-in gate. */
  syncEnabled: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSyncConfigured)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setLoading(false)
      // A different account signing in on this device must not inherit the
      // previous one's cached rows.
      if (event === 'SIGNED_OUT') void stopSync().then(clearLocalData)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id ?? null
  useEffect(() => {
    if (uid) void startSync(uid)
  }, [uid])

  const value: AuthValue = {
    loading,
    session,
    email: session?.user.email ?? null,
    syncEnabled: isSyncConfigured,
    async signIn(email: string, password: string) {
      if (!supabase) return { error: 'Sync is not configured.' }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return error ? { error: error.message } : {}
    },

    async signUp(email: string, password: string) {
      if (!supabase) return { error: 'Sync is not configured.' }
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) return { error: error.message }
      // With "Confirm email" enabled, sign-up succeeds but issues no session
      // until the emailed link is opened — worth saying plainly rather than
      // leaving the user on a form that looks like it did nothing.
      if (!data.session) return { needsConfirmation: true }
      return {}
    },
    async signOut() {
      if (!supabase) return
      await supabase.auth.signOut()
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
