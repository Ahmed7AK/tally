# Habit reminders

From **18:00 local time**, if any of the day's habits are still unlogged, Tally
pushes a notification to your phone every **30 minutes** until they're all
ticked — or until 22:00, whichever comes first.

The client half is already deployed. Three server steps remain, because they
need credentials only you hold.

## How it fits together

```
pg_cron  ──every 30 min──▶  Edge Function  ──asks──▶  pending_habit_reminders()
                                 │                          │
                                 │                    "who still owes
                                 │                     habits right now?"
                                 ▼
                          Web Push ──▶ your iPhone
```

All the decision logic lives in the SQL function, so the Edge Function is a dumb
sender. The cron schedule is fixed and timezone-agnostic: it fires every 30
minutes regardless, and the SQL decides whether anyone is actually due, using
**each device's own timezone** — so travelling doesn't shift your 6pm.

## 1. Run the migration

Paste `supabase/migrate-005-reminders.sql` into the SQL Editor.

**Before running**, replace two placeholders near the bottom:

- `<PROJECT-REF>` — your project ref
- `<SERVICE-ROLE-KEY>` — Project Settings → API Keys → `service_role`

The service-role key bypasses row-level security, so it belongs only in this
schedule and in the function's environment. Never in the client.

## 2. Deploy the Edge Function

Dashboard → **Edge Functions** → *Deploy a new function* → name it
`habit-reminder`, and paste `supabase/functions/habit-reminder/index.ts`.

Or from a terminal, if you install the CLI:

```bash
supabase functions deploy habit-reminder
```

## 3. Set the function's secrets

Edge Functions → `habit-reminder` → **Secrets**:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | `BKWhufmrWPI77Xf0hy6hrGKehFOIGv9aig0aSVaOTf6VEEoddQ_TBsr0cJFQBudC9cO9QHiqw7YXUEK1TZK6dFs` |
| `VAPID_PRIVATE_KEY` | in `.vapid-private.txt` at the repo root — gitignored, never committed |
| `VAPID_SUBJECT` | `mailto:your@email.com` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

> The **public** key is already built into the deployed client and is safe to
> share. The **private** key signs the pushes — anyone holding it can send
> notifications that appear to come from Tally. If it leaks, generate a new pair
> and every device will need to re-subscribe.

## 4. Turn it on, on the phone

1. Tally must be on the **Home Screen** — iOS refuses push to a browser tab.
2. Open it, find **Habit reminders** in the settings area, tap it, and allow
   notifications when iOS asks.
3. Tap **Send a test notification** to confirm the plumbing before 6pm.

Permission has to be requested from a tap; iOS ignores requests that aren't.

## Checking it works

Call the function by hand — it returns what it did without waiting for cron:

```bash
curl -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/habit-reminder" -H "Authorization: Bearer <SERVICE-ROLE-KEY>"
```

`{"due":0,"sent":0,"expired":0}` before 6pm is correct — nobody is due.
`due` counts devices in the window with habits outstanding.

Confirm the schedule is registered:

```sql
select jobname, schedule, active from cron.job where jobname = 'tally-habit-reminders';
```

## Design notes

- **One notification, replaced** — every reminder uses the tag `habit-reminder`,
  so the 8pm ping replaces the 7:30pm one instead of stacking nine notifications
  on your lock screen by bedtime.
- **Dead endpoints self-clean** — when a browser discards a subscription, push
  returns 404/410 and the row is deleted, rather than being retried every 30
  minutes forever.
- **TTL is 30 minutes** — there is no point delivering a reminder after the next
  one is already due.
- **Nothing fires with zero habits** — the query requires at least one habit, so
  a fresh account is not nagged about an empty list.

## Limits worth knowing

Push on iOS is best-effort. Apple throttles delivery for apps you rarely open,
and notifications will not arrive at all if the PWA is removed from the Home
Screen. Treat it as a nudge, not an alarm.
