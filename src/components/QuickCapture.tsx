import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Label } from './ui'

/* ---------------------------------------------------------------------------
   Quick-capture tokens for the iOS Shortcut.

   These used to be minted by pasting SQL into the Supabase dashboard and
   copying the result out by hand, which is exactly the kind of step that fails
   silently — a truncated paste produces "unauthorized" with nothing to
   distinguish it from a token that was never created.

   The table's row-level security already scopes rows to their owner, so the
   signed-in client can manage its own tokens directly. No extra SQL needed.
   --------------------------------------------------------------------------- */

interface TokenRow {
  token: string
  label: string
  created_at: string
  last_used: string | null
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function shorten(token: string): string {
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

export default function QuickCapture() {
  const [rows, setRows] = useState<TokenRow[] | null>(null)
  const [open, setOpen] = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error: err } = await supabase
      .from('quick_add_tokens')
      .select('token,label,created_at,last_used')
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setRows((data ?? []) as TokenRow[])
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  if (!supabase) return null

  async function create() {
    setError('')
    const { data: userData } = await supabase!.auth.getUser()
    const userId = userData.user?.id
    if (!userId) return setError('Not signed in.')

    const token = newToken()
    const { error: err } = await supabase!
      .from('quick_add_tokens')
      .insert({ token, user_id: userId, label: 'iPhone' })
    if (err) return setError(err.message)

    setJustCreated(token)
    setCopied(false)
    void load()
  }

  async function revoke(token: string) {
    await supabase!.from('quick_add_tokens').delete().eq('token', token)
    if (justCreated === token) setJustCreated(null)
    void load()
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setError('Could not copy — select the token and copy it manually.')
    }
  }

  return (
    <div className="section">
      <button className="ghost-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ⌘ Siri quick capture
      </button>

      {open && (
        <div className="capture">
          <Label>Shortcut endpoint</Label>
          <code className="capture-code">{import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/quick_add</code>

          {justCreated && (
            <>
              <Label accent>New token — copy it now</Label>
              <code className="capture-code capture-token">{justCreated}</code>
              <button className="btn-primary" onClick={() => void copy(justCreated)}>
                {copied ? '✓ Copied' : 'Copy token'}
              </button>
            </>
          )}

          {rows && rows.length > 0 && (
            <div className="rows">
              {rows.map((r) => (
                <div className="row" key={r.token}>
                  <div className="row-body">
                    <span className="row-title">{r.label || 'Device'}</span>
                    <span className="row-tag">
                      {shorten(r.token)} · {r.last_used ? 'used' : 'never used'}
                    </span>
                  </div>
                  <button
                    className="row-del"
                    onClick={() => void revoke(r.token)}
                    aria-label={`Revoke ${r.label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {rows && rows.length === 0 && !justCreated && (
            <span className="hint">
              No tokens yet — this is why the Shortcut returns “unauthorized”.
            </span>
          )}

          <button className="ghost-btn" onClick={() => void create()}>
            ＋ Create a token
          </button>

          {error && <span className="signin-error">{error}</span>}
          <span className="hint">
            The token is shown once. Paste it into the Shortcut's <code>p_token</code> field.
            Revoking one stops that device immediately.
          </span>
        </div>
      )}
    </div>
  )
}
