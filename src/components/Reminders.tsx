import { useCallback, useEffect, useState } from 'react'
import {
  disablePush,
  enablePush,
  getPushState,
  pushDiagnostics,
  sendLocalTest,
  sendPushTest,
  type PushDiagnostics,
  type PushState,
} from '../lib/push'

const EXPLAIN: Record<PushState, string> = {
  on: 'From 6pm, every 30 minutes until your habits are all logged.',
  off: 'Get a nudge from 6pm if any habit is still unlogged.',
  denied: 'Notifications are blocked. Allow them in Settings → Tally → Notifications.',
  'needs-install': 'Add Tally to your Home Screen first — iOS only delivers push to installed apps.',
  unsupported: 'This browser cannot receive push notifications.',
  unconfigured: 'No VAPID key is configured in this build.',
}

export default function Reminders() {
  const [state, setState] = useState<PushState | null>(null)
  const [diag, setDiag] = useState<PushDiagnostics | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setState(await getPushState())
    setDiag(await pushDiagnostics())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (state === null) return null

  const actionable = state === 'on' || state === 'off'

  /** Every action reports what happened. The previous version discarded
   *  rejections, so a failure was indistinguishable from a notification that
   *  iOS had simply declined to show. */
  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true)
    setMessage(label)
    setFailed(false)
    try {
      const result = await fn()
      setMessage(typeof result === 'string' ? result : 'Done.')
    } catch (err) {
      setMessage((err as Error).message)
      setFailed(true)
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  return (
    <div className="section">
      <button
        className="ghost-btn"
        onClick={() =>
          void run('Working…', async () => {
            setState(state === 'on' ? await disablePush() : await enablePush())
          })
        }
        disabled={busy || !actionable}
        aria-pressed={state === 'on'}
      >
        {state === 'on' ? '🔔 Habit reminders on' : '🔕 Habit reminders off'}
      </button>
      <span className="hint">{EXPLAIN[state]}</span>

      {state === 'on' && (
        <>
          <button
            className="ghost-btn"
            disabled={busy}
            onClick={() =>
              void run('Switch away from Tally — firing in 4 seconds…', async () => {
                await sendLocalTest()
                return 'Local notification fired. If nothing appeared, check Settings → Notifications.'
              })
            }
          >
            Test locally
          </button>
          <button
            className="ghost-btn"
            disabled={busy}
            onClick={() => void run('Asking the server…', sendPushTest)}
          >
            Test from the server
          </button>
          {message && (
            <span className={failed ? 'signin-error' : 'hint'}>{message}</span>
          )}
        </>
      )}

      {diag && (
        <details className="diag">
          <summary>Diagnostics</summary>
          <dl className="diag-list">
            <dt>Permission</dt>
            <dd data-bad={diag.permission !== 'granted'}>{diag.permission}</dd>
            <dt>Installed</dt>
            <dd data-bad={diag.ios && !diag.installed}>{diag.installed ? 'yes' : 'no'}</dd>
            <dt>Service worker</dt>
            <dd data-bad={diag.serviceWorker === 'none'}>{diag.serviceWorker}</dd>
            <dt>Subscribed</dt>
            <dd data-bad={!diag.subscribed}>{diag.subscribed ? 'yes' : 'no'}</dd>
            <dt>Push service</dt>
            <dd>{diag.pushService ?? '—'}</dd>
            <dt>VAPID key</dt>
            <dd data-bad={!diag.vapidConfigured}>{diag.vapidConfigured ? 'present' : 'missing'}</dd>
          </dl>
          <span className="hint">
            iOS does not show a banner while Tally is open. Switch to another app, or lock the
            screen, before testing.
          </span>
        </details>
      )}
    </div>
  )
}
