import { supabase } from './supabase'

/* ---------------------------------------------------------------------------
   Web push subscription.

   iOS only delivers push to a PWA that has been added to the Home Screen, and
   only asks for permission from inside a user gesture. Both constraints are
   checked here so the UI can explain itself rather than failing silently.
   --------------------------------------------------------------------------- */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export type PushState =
  | 'unsupported' // no service worker or Push API
  | 'needs-install' // iOS Safari, not yet on the Home Screen
  | 'unconfigured' // no VAPID key built in
  | 'denied' // permission refused
  | 'off' // supported and allowed, not subscribed
  | 'on'

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** base64url -> Uint8Array, the format `applicationServerKey` expects. */
function decodeKey(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // On iOS the Push API only exists once installed, so distinguish the two.
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/** Must be called from a user gesture — iOS ignores permission requests that
 *  are not. Returns the resulting state. */
export async function enablePush(): Promise<PushState> {
  const state = await getPushState()
  if (state !== 'off') return state

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(VAPID_PUBLIC_KEY) as BufferSource,
  })

  await saveSubscription(sub)
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await removeSubscription(sub.endpoint)
    await sub.unsubscribe()
  }
  return 'off'
}

/** The endpoint is the row key: re-subscribing on the same device replaces its
 *  row instead of accumulating dead endpoints that push will 410 on forever. */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  if (!supabase) return
  const { data } = await supabase.auth.getUser()
  const userId = data.user?.id
  if (!userId) return

  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
  await supabase.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      user_id: userId,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      // Reminders fire against the device's own clock, not the server's.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      updated_at: Date.now(),
    },
    { onConflict: 'endpoint' },
  )
}

async function removeSubscription(endpoint: string): Promise<void> {
  if (!supabase) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}

/** Everything needed to tell why a notification did not appear. */
export interface PushDiagnostics {
  permission: NotificationPermission
  installed: boolean
  ios: boolean
  serviceWorker: 'controlling' | 'registered' | 'none'
  subscribed: boolean
  /** Host only — the endpoint itself is a credential. */
  pushService: string | null
  vapidConfigured: boolean
}

export async function pushDiagnostics(): Promise<PushDiagnostics> {
  const hasSW = 'serviceWorker' in navigator
  const reg = hasSW ? await navigator.serviceWorker.getRegistration() : null
  const sub = reg ? await reg.pushManager?.getSubscription() : null

  return {
    permission: typeof Notification === 'undefined' ? 'default' : Notification.permission,
    installed: isStandalone(),
    ios: isIOS(),
    serviceWorker: navigator.serviceWorker?.controller
      ? 'controlling'
      : reg
        ? 'registered'
        : 'none',
    subscribed: Boolean(sub),
    pushService: sub ? new URL(sub.endpoint).host : null,
    vapidConfigured: Boolean(VAPID_PUBLIC_KEY),
  }
}

/** Fires a *local* notification. This proves permission and the service worker
 *  are healthy; it does not prove the server can reach this device — use
 *  `sendPushTest` for that.
 *
 *  Delayed on purpose: iOS does not show a banner while the app is in the
 *  foreground, so an immediate notification looks like a failure. The delay
 *  gives you time to switch away. */
export async function sendLocalTest(delayMs = 4000): Promise<void> {
  if (Notification.permission !== 'granted') {
    throw new Error(`Notification permission is "${Notification.permission}", not "granted".`)
  }
  const reg = await navigator.serviceWorker.ready
  await new Promise((r) => setTimeout(r, delayMs))
  await reg.showNotification('Tally', {
    body: 'Local test — this is what a reminder looks like.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'habit-reminder',
  })
}

/** End-to-end test: asks the server to push to this account's devices, which
 *  exercises the VAPID keys, the stored subscription and the push service —
 *  everything the 6pm reminder depends on. */
/** supabase-js reports every failed invoke as "Edge Function returned a non-2xx
 *  status code" and throws the body away. The body is the only part that says
 *  what went wrong, so dig it back out of the attached Response. */
async function describeInvokeError(error: unknown): Promise<string> {
  const response = (error as { context?: Response }).context
  const fallback = (error as Error).message ?? 'Unknown error'

  if (!response || typeof response.text !== 'function') return fallback

  let detail = ''
  try {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string }
      detail = parsed.error ?? parsed.message ?? text
    } catch {
      detail = text
    }
  } catch {
    // Body already consumed or unreadable — the status alone still helps.
  }

  switch (response.status) {
    case 404:
      return 'The habit-reminder function is not deployed under that name.'
    case 401:
      return detail.includes('sign in')
        ? 'The function rejected the sign-in. Redeploy it — the test path is new.'
        : `Unauthorized (401). ${detail}`
    case 500:
      // Usually a boot failure: a bad import or a missing secret.
      return `The function errored (500). ${detail || 'Check its logs and that all three VAPID secrets are set.'}`
    default:
      return `HTTP ${response.status}. ${detail || fallback}`
  }
}

export async function sendPushTest(): Promise<string> {
  if (!supabase) throw new Error('Sync is not configured.')

  const { data, error } = await supabase.functions.invoke('habit-reminder', {
    body: { test: true },
  })
  if (error) throw new Error(await describeInvokeError(error))

  const result = data as { sent?: number; due?: number; failures?: string[] } | null
  const sent = result?.sent ?? 0

  if (sent === 0) {
    if (result?.failures?.length) {
      // A 401/403 from the push service means the function's VAPID keys are
      // not the pair this device subscribed with.
      throw new Error(`Push rejected — ${result.failures[0]}`)
    }
    if ((result?.due ?? 0) === 0) {
      throw new Error(
        'The server has no push subscription for this device. Switch reminders off and on to re-register.',
      )
    }
    throw new Error('The server tried but every push failed. Check the function logs.')
  }

  return `Server pushed to ${sent} device${sent === 1 ? '' : 's'}. Lock your screen to see it.`
}
