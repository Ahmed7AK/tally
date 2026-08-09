import { useEffect, useState } from 'react'
import { getSyncState, onSyncStateChange, syncNow, type SyncState } from '../sync/sync'
import { useAuth } from '../auth/AuthProvider'

/** Escape hatch for a device stuck on an old bundle: drop every cache and
 *  service worker, then hard-reload. Local data lives in IndexedDB, which this
 *  does not touch. */
async function forceUpdate(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    await Promise.all((regs ?? []).map((r) => r.unregister()))
    const keys = await caches?.keys?.()
    await Promise.all((keys ?? []).map((k) => caches.delete(k)))
  } catch {
    // Nothing to clean, or the APIs are unavailable — reload regardless.
  }
  window.location.reload()
}

const COPY: Record<SyncState, string> = {
  idle: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — saved locally',
  error: 'Sync failed',
  disabled: 'Local only',
}

export function useSyncState() {
  const [{ state, detail }, set] = useState(getSyncState)
  useEffect(() => onSyncStateChange((s, d) => set({ state: s, detail: d })), [])
  return { state, detail }
}

/** Compact status pill. Clicking retries when something went wrong. */
export default function SyncStatus() {
  const { state, detail } = useSyncState()
  const { email, signOut, syncEnabled } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <div className="sync">
      <button className="sync-pill" data-state={state} onClick={() => setOpen((v) => !v)}>
        <span className="sync-dot" />
        <span className="sync-text">{COPY[state]}</span>
      </button>

      {open && (
        <div className="sync-panel">
          {email && <span className="sync-email">{email}</span>}
          {state === 'error' && detail && <span className="sync-detail">{detail}</span>}
          {!syncEnabled && (
            <span className="sync-detail">
              No Supabase credentials configured. Data stays on this device.
            </span>
          )}
          {syncEnabled && (
            <button className="ghost-btn" onClick={() => void syncNow()}>
              ⟳ Sync now
            </button>
          )}
          <button
            className="ghost-btn"
            onClick={() => void forceUpdate()}
            title="Discard cached files and reload"
          >
            ⇧ Update app
          </button>
          <span className="sync-detail">Build {__BUILD_ID__}</span>
          {email && (
            <button className="ghost-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  )
}
