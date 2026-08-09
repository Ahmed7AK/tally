import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'

type Mode = 'signin' | 'signup'

/** Supabase's own default minimum. Checked here so a too-short password fails
 *  instantly instead of after a round trip. */
const MIN_PASSWORD = 6

export default function SignIn() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmSent, setConfirmSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim()
    if (!address || !password) return
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }

    setBusy(true)
    setError('')
    const result = mode === 'signin' ? await signIn(address, password) : await signUp(address, password)
    setBusy(false)

    if (result.error) setError(result.error)
    else if (result.needsConfirmation) setConfirmSent(true)
    // On success the session lands and the shell swaps this screen out.
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setConfirmSent(false)
  }

  if (confirmSent) {
    return (
      <div className="signin">
        <div className="signin-card">
          <div className="d-brand" style={{ padding: 0 }}>
            <span className="d-brand-dot" />
            <span className="d-brand-name">TALLY</span>
          </div>
          <h1 className="signin-title">Confirm your account</h1>
          <p className="signin-copy">
            The account was created, but this project has email confirmation switched on, so it
            can't sign in until it's confirmed.
          </p>
          <p className="signin-copy">
            Either open the confirmation email, or confirm it yourself in Supabase under
            <strong> Authentication → Users</strong>. Then come back and sign in.
          </p>
          <button className="ghost-btn" onClick={() => switchMode('signin')}>
            ← Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="d-brand" style={{ padding: 0 }}>
          <span className="d-brand-dot" />
          <span className="d-brand-name">TALLY</span>
        </div>

        <h1 className="signin-title">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        <p className="signin-copy">
          {mode === 'signin'
            ? 'Use the same account on your phone and your Mac and they stay in sync.'
            : `Pick a password of at least ${MIN_PASSWORD} characters. Your password manager should offer to save it.`}
        </p>

        <form onSubmit={submit} className="signin-form">
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            className="signin-input"
          />
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            className="signin-input"
          />
          <button type="submit" className="signin-submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {error && <p className="signin-error">{error}</p>}

        <button
          className="ghost-btn"
          onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? 'Create an account instead' : 'I already have an account'}
        </button>
      </div>
    </div>
  )
}
