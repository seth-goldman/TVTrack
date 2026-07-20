import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env.local and fill it in.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Authenticated fetch against our own /api routes. Refreshes the session when
 * the access token is within 60s of expiry so a long-running import does not
 * die halfway through.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) throw new Error('Not authenticated')

  if (session.expires_at && session.expires_at - Math.floor(Date.now() / 1000) < 60) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) throw new Error('Session expired — please sign in again')
    session = data.session
  }

  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  })
}

/** apiFetch + JSON parse + error unwrapping, which is what every caller wants. */
export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options)
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`)
  if (body === null) throw new Error('Empty response')
  return body
}
