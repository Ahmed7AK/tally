// Tally — habit reminder sender.
//
// Called by pg_cron every 30 minutes. All the "who is due?" logic lives in the
// pending_habit_reminders() SQL function, so this is a dumb sender: ask, push,
// clean up dead endpoints.
//
// Nothing runs at module scope on purpose. An earlier version read secrets and
// called setVapidDetails() at import time, so a missing secret or a failed
// dependency load killed the worker before it could serve a request — which
// surfaces as an opaque WORKER_ERROR with no clue as to which. Everything now
// happens inside the handler, behind a try/catch that names the stage it
// reached.
//
// Deploy from the dashboard (Edge Functions -> Deploy a new function) or with
// `supabase functions deploy habit-reminder`.
//
// Required secrets:
//   VAPID_PUBLIC_KEY   same value the client is built with
//   VAPID_PRIVATE_KEY  keep server-side only
//   VAPID_SUBJECT      mailto:you@example.com
//
// Send {"probe": true} to check the environment without pushing anything.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

interface Pending {
  endpoint: string
  p256dh: string
  auth: string
  remaining: number
  total: number
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function env(name: string): string | null {
  const value = Deno.env.get(name)
  return value && value.trim() ? value.trim() : null
}

function reminderBody(remaining: number, total: number): string {
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

/** Devices belonging to the caller, ignoring the time window and habit check.
 *  Identified from the caller's own JWT, so a test can only reach your own
 *  phone — never someone else's. */
async function testTargets(supabase: SupabaseClient, authHeader: string | null): Promise<Pending[]> {
  if (!authHeader) throw new Error('No Authorization header — sign in and retry.')

  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data.user) {
    throw new Error('That token is not a signed-in user (a service key cannot run the test path).')
  }

  const { data: subs, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('user_id', data.user.id)
  if (subErr) throw new Error(`Reading subscriptions failed: ${subErr.message}`)

  return (subs ?? []).map((s) => ({ ...s, remaining: 1, total: 1 }) as Pending)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Names the last checkpoint reached, so a 500 says where it broke.
  let stage = 'start'

  try {
    let body: { test?: boolean; probe?: boolean } = {}
    try {
      body = (await req.json()) ?? {}
    } catch {
      // The cron posts an empty body.
    }

    stage = 'read-env'
    const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']
      .filter((name) => !env(name))

    if (body.probe) {
      // Reports health without sending or requiring a working dependency.
      let webpushLoads = false
      let importError: string | null = null
      try {
        await import('npm:web-push@3.6.7')
        webpushLoads = true
      } catch (err) {
        importError = (err as Error).message
      }
      return json({
        ok: missing.length === 0 && webpushLoads,
        missingSecrets: missing,
        vapidSubject: env('VAPID_SUBJECT') ?? '(unset — will default)',
        webpushLoads,
        importError,
      })
    }

    if (missing.length > 0) {
      return json({ error: `Missing secrets: ${missing.join(', ')}`, stage }, 500)
    }

    stage = 'import-webpush'
    const mod = await import('npm:web-push@3.6.7')
    const webpush = (mod.default ?? mod) as {
      setVapidDetails: (s: string, pub: string, priv: string) => void
      sendNotification: (sub: unknown, payload: string, opts?: unknown) => Promise<unknown>
    }

    stage = 'set-vapid'
    // A subject must be a mailto: or https: URL; web-push throws otherwise, and
    // that throw used to happen at import time.
    const subject = env('VAPID_SUBJECT') ?? 'mailto:tally@example.com'
    webpush.setVapidDetails(subject, env('VAPID_PUBLIC_KEY')!, env('VAPID_PRIVATE_KEY')!)

    stage = 'connect'
    const supabase = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)

    stage = body.test ? 'collect-test-targets' : 'query-pending'
    let pending: Pending[]
    if (body.test) {
      try {
        pending = await testTargets(supabase, req.headers.get('Authorization'))
      } catch (err) {
        return json({ error: (err as Error).message, stage }, 401)
      }
    } else {
      const { data, error } = await supabase.rpc('pending_habit_reminders')
      if (error) return json({ error: `pending_habit_reminders: ${error.message}`, stage }, 500)
      pending = (data ?? []) as Pending[]
    }

    stage = 'send'
    let sent = 0
    const expired: string[] = []
    const failures: string[] = []

    await Promise.all(
      pending.map(async (p) => {
        try {
          await webpush.sendNotification(
            { endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } },
            body.test
              ? JSON.stringify({
                  title: 'Tally',
                  body: 'Push test — the server reached this device.',
                  tag: 'habit-reminder',
                  url: '/',
                })
              : reminderBody(p.remaining, p.total),
            { TTL: 1800 }, // Pointless to deliver after the next reminder is due.
          )
          sent++
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          // 404/410 mean the browser threw the subscription away — the row is
          // dead and would otherwise be retried every 30 minutes forever.
          if (status === 404 || status === 410) expired.push(p.endpoint)
          else failures.push(`${status ?? 'error'}: ${(err as Error).message}`)
        }
      }),
    )

    stage = 'cleanup'
    if (expired.length > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expired)
    }
    if (sent > 0) {
      await supabase
        .from('push_subscriptions')
        .update({ last_sent: new Date().toISOString() })
        .in('endpoint', pending.map((p) => p.endpoint))
    }

    return json({ due: pending.length, sent, expired: expired.length, failures })
  } catch (err) {
    // Anything unexpected still answers with something actionable rather than
    // taking the worker down.
    return json({ error: (err as Error).message ?? String(err), stage }, 500)
  }
})
