import { supabase } from './supabase.js'

export async function signUp({ email, password, displayName }) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || email.split('@')[0] },
    },
  })
  if (error) throw error
  return data
}

export async function signIn({ email, password }) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}

export async function sendPasswordReset(email) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  })
  if (error) throw error
}

export function onAuthChange(callback) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null, event)
  })
  return () => data.subscription.unsubscribe()
}

export async function getSession() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}
