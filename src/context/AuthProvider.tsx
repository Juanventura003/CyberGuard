import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return
    let active = true
    let authChanged = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || authChanged) return
      setSession(session)
      setLoading(false)
    }).catch(() => {
      if (active && !authChanged) setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      authChanged = true
      setSession(session)
      setLoading(false)
    })

    return () => { active = false; subscription.unsubscribe() }
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

