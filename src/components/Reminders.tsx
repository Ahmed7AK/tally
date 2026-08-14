import { useEffect, useState } from 'react'
import {
  disablePush,
  enablePush,
  getPushState,
  sendTestNotification,
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getPushState().then(setState)
  }, [])

  if (state === null) return null

  const actionable = state === 'on' || state === 'off'

  async function toggle() {
    setBusy(true)
    try {
      setState(state === 'on' ? await disablePush() : await enablePush())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section">
      <button
        className="ghost-btn"
        onClick={() => void toggle()}
        disabled={busy || !actionable}
        aria-pressed={state === 'on'}
      >
        {state === 'on' ? '🔔 Habit reminders on' : '🔕 Habit reminders off'}
      </button>
      <span className="hint">{EXPLAIN[state]}</span>
      {state === 'on' && (
        <button className="ghost-btn" onClick={() => void sendTestNotification()}>
          Send a test notification
        </button>
      )}
    </div>
  )
}
