// Tally — habit reminder sender.
//
// Called by pg_cron every 30 minutes. All the "who is due?" logic lives in the
// pending_habit_reminders() SQL function, so this is a dumb sender: ask, push,
// clean up dead endpoints.
//
// Deploy from the Supabase dashboard (Edge Functions -> Deploy a new function)
// or with `supabase functions deploy habit-reminder`.
//
// Required secrets:
//   VAPID_PUBLIC_KEY   same value the client is built with
//   VAPID_PRIVATE_KEY  keep server-side only
//   VAPID_SUBJECT      mailto:you@example.com

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface Pending {
  endpoint: string
  p256dh: string
  auth: string
  remaining: number
  total: number
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Service role: this runs with no user session and must read every device's
// subscription, so it deliberately bypasses RLS.
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:tally@example.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

function body(remaining: number, total: number) {
  const done = total - remaining
  return JSON.stringify({
    title: 'Habits still open',
    body:
      remaining === 1
        ? `1 habit left to log today (${done}/${total} done).`
        : `${remaining} habits left to log today (${done}/${total} done).`,
    tag: 'habit-reminder',
    url: '/',
  })
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Devices belonging to the caller, ignoring the time window and habit check.
 *  Identified from the caller's own JWT, so a test can only ever reach your own
 *  phone — never someone else's. */
async function testTargets(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<Pending[]> {
  if (!authHeader) throw new Error('sign in first')

  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  if (userErr || !userData.user) throw new Error('sign in first')

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('user_id', userData.user.id)
  if (error) throw new Error(error.message)

  return (data ?? []).map((d) => ({ ...d, remaining: 1, total: 1 }) as Pending)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  let isTest = false
  try {
    isTest = (await req.clone().json())?.test === true
  } catch {
    // No body, or not JSON — the cron calls it that way.
  }

  let pending: Pending[]
  if (isTest) {
    try {
      pending = await testTargets(supabase, req.headers.get('Authorization'))
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
  } else {
    const { data, error } = await supabase.rpc('pending_habit_reminders')
    if (error) {
      console.error('pending_habit_reminders failed', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    pending = (data ?? []) as Pending[]
  }

  let sent = 0
  const expired: string[] = []
  const failures: string[] = []

  await Promise.all(
    pending.map(async (p) => {
      try {
        await webpush.sendNotification(
          { endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } },
          isTest
            ? JSON.stringify({
                title: 'Tally',
                body: 'Push test — the server reached this device.',
                tag: 'habit-reminder',
                url: '/',
              })
            : body(p.remaining, p.total),
          { TTL: 1800 }, // Pointless to deliver after the next reminder is due.
        )
        sent++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404/410 mean the browser threw the subscription away — the row is
        // dead and would otherwise be retried every 30 minutes forever.
        if (status === 404 || status === 410) expired.push(p.endpoint)
        else {
          // Surfaced in the response for the test path: a 401/403 here means
          // the VAPID keys do not match the ones the device subscribed with.
          failures.push(`${status ?? 'error'}: ${(err as Error).message}`)
          console.error('push failed', p.endpoint.slice(-12), status, err)
        }
      }
    }),
  )

  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expired)
  }

  if (sent > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ last_sent: new Date().toISOString() })
      .in('endpoint', pending.map((p) => p.endpoint))
  }

  return new Response(
    JSON.stringify({ due: pending.length, sent, expired: expired.length, failures }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
