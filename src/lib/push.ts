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

/** Fires a local notification so the user can confirm the plumbing works
 *  without waiting until 6pm. */
export async function sendTestNotification(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  await reg.showNotification('Tally', {
    body: 'Reminders are on. This is what 6pm will look like.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'habit-reminder',
  })
}
