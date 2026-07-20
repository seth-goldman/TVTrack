import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui'

// Magic-link only (PRD F1). There is deliberately no signup form: accounts are
// created by hand in the Supabase dashboard, so an unknown address gets a
// silent no-op rather than a new account.
export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
    })
    setBusy(false)
    if (err) setError(err.message)
    else setSent(true)
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold tracking-tight">ShowTrack</h1>
        <p className="mt-2 text-sm text-white/50">
          Your shows, your episodes, your data.
        </p>

        {sent ? (
          <div className="mt-8 rounded-xl border border-hairline bg-surface p-4 text-sm">
            <p className="font-medium">Check your email</p>
            <p className="mt-1 text-white/60">
              We sent a sign-in link to {email}. Open it on this device.
            </p>
            <button
              className="mt-3 text-sm font-medium text-brand-soft"
              onClick={() => setSent(false)}
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
            <label className="text-sm text-white/60" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-12 rounded-xl border border-hairline bg-surface px-4 text-base outline-none focus:border-brand"
              placeholder="you@example.com"
            />
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" busy={busy} className="mt-1">
              Send sign-in link
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
