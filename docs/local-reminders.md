# Local reminders with Shortcuts

An alternative to web push: iOS runs the schedule itself, and Tally only
answers a question. No VAPID keys, no Edge Function, no cron.

## Why not just schedule it in the app

An installed iOS PWA cannot schedule a notification for a future time:

- `setTimeout` is killed when iOS suspends the web view, seconds after you
  switch away
- Safari never shipped the **Notification Triggers API**, which exists for
  exactly this
- **Background Sync** and **Periodic Background Sync** are unsupported on iOS

A service worker only runs when something wakes it, and while the app is closed
the only thing that can is an incoming push. Shortcuts automations are run by
iOS itself, which sidesteps all of it.

The trade-off is honest: this needs one automation per reminder time, set up by
hand once. Push needs none, but needs a working server.

## 1. Run the migration

Paste `supabase/migrate-009-habit-status.sql` into the SQL Editor. It adds one
read-only function and reuses your quick-capture token, so there's no new
credential.

## 2. Get a token

In Tally: **⌘ Siri quick capture → ＋ Create a token**, and copy it. The same
token works for both capture and this.

## 3. Build the shortcut

**Shortcuts → + → new shortcut**, named `Check habits`:

1. **Get Contents of URL**
   - URL: `https://<YOUR-PROJECT-REF>.supabase.co/rest/v1/rpc/habit_status`
   - Method: **POST**
   - Headers:
     | Key | Value |
     |---|---|
     | `apikey` | your Supabase anon key |
     | `Content-Type` | `application/json` |
   - Request Body: **JSON**
     | Key | Type | Value |
     |---|---|---|
     | `p_token` | Text | your token |
     | `p_timezone` | Text | `Asia/Dubai` |

2. **Get Dictionary Value** — key `remaining`, from the previous step

3. **If** — *Dictionary Value* **is greater than** `0`
   - **Get Dictionary Value** — key `message`
   - **Show Notification** — body: that value
   - *(leave the Otherwise branch empty)*

Run it once by hand. With habits outstanding you should get a notification;
with everything logged, nothing.

## 4. Schedule it

**Shortcuts → Automation → + → Time of Day**

- Time: **18:00**, Daily
- **Run Immediately**, and turn **Notify When Run** off
- Action: **Run Shortcut → Check habits**

Repeat for each reminder time you want: 18:30, 19:00, 19:30, and so on. Eight
automations covers 18:00–21:30 at half-hour intervals.

Tedious once, then silent forever. Each one only notifies if something is
actually outstanding.

## Checking it

```bash
curl -X POST "https://<YOUR-PROJECT-REF>.supabase.co/rest/v1/rpc/habit_status" -H "apikey: <ANON-KEY>" -H "Content-Type: application/json" -d '{"p_token":"<YOUR-TOKEN>","p_timezone":"Asia/Dubai"}'
```

```json
{"date":"2026-08-14","total":5,"done":3,"remaining":2,"message":"2 habits left to log today."}
```

`unauthorized` means the token doesn't match a row — create one in the app.

## Compared with push

| | Shortcuts | Web push |
|---|---|---|
| Setup | 8 automations by hand | 3 server steps |
| Moving parts | one function | function, cron, VAPID, Edge Function |
| Fails when | you delete an automation | any link in the chain breaks |
| Reliability | iOS runs it | best-effort, Apple throttles |
| Works on Mac | no | yes |

They coexist — the same habit data, two independent triggers. If push starts
working later, delete the automations.
