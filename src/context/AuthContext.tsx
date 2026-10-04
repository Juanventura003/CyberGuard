import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthContextType {
  session: Session | null
  user: User | null
  loading: boolean
  signUp: (email: string, password: string, metadata: { username: string; firstName: string; lastName: string }) => Promise<{ error: Error | null }>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const publishSession = () => {
      if (loading) return

      const accessToken = session?.access_token ?? null
      window.postMessage({ type: 'CYBERGUARD_AUTH', accessToken }, window.location.origin)
      window.postMessage({ type: 'CYBERGUARD_HISTORY', enabled: Boolean(session) }, window.location.origin)
    }

    window.addEventListener('cyberguard-auth-request', publishSession)
    publishSession()

    return () => window.removeEventListener('cyberguard-auth-request', publishSession)
  }, [loading, session])

   const signUp = async (email: string, password: string, metadata: { username: string; firstName: string; lastName: string }) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    })
    return { error }
  }

  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signOut = async () => {
    if (!supabase) return

    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}