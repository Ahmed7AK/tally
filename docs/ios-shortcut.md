# Quick capture from iOS Shortcuts

Add a task to Tally by talking to Siri, from the share sheet, or from a
home-screen widget — without opening the app.

## Why it works this way

Supabase access tokens expire after an hour, and Shortcuts has no sensible way
to run a refresh loop. Storing your account password in a Shortcut would be
worse. So capture goes through a dedicated endpoint holding a per-device token
that can do exactly one thing: append a task. It cannot read, edit, or delete
anything, and revoking it is deleting one row.

## 1. Run the migration

If you haven't already, paste `supabase/migrate-002-recurrence-subtasks-shortcuts.sql`
into the Supabase **SQL Editor** and run it.

## 2. Mint a token

Find your user id under **Authentication → Users**, then run this in the SQL
Editor, substituting it:

```sql
insert into public.quick_add_tokens (token, user_id, label)
values (encode(gen_random_bytes(24), 'hex'), '<YOUR-USER-UUID>', 'iPhone')
returning token;
```

Copy the returned token. Treat it like a password — anyone holding it can append
tasks to your list. Mint a separate one per device so you can revoke them
independently:

```sql
delete from public.quick_add_tokens where label = 'iPhone';
```

## 3. Build the Shortcut

Open **Shortcuts → +** and add these actions in order:

1. **Ask for Input**
   - Input type: Text
   - Prompt: `Add to Tally`
   *(Skip this and use "Shortcut Input" instead if you want it in the share sheet.)*

2. **Get Contents of URL**
   - URL: `https://YOUR-PROJECT-REF.supabase.co/rest/v1/rpc/quick_add`
   - Method: **POST**
   - Headers:
     | Key | Value |
     |---|---|
     | `apikey` | your Supabase anon/publishable key |
     | `Content-Type` | `application/json` |
   - Request Body: **JSON**
     | Key | Type | Value |
     |---|---|---|
     | `p_token` | Text | the token from step 2 |
     | `p_text` | Text | **Provided Input** (the magic variable from step 1) |

3. *(Optional)* **Show Notification** with the result, so you get confirmation.

Name it something Siri can hear cleanly — "Add to Tally" works well.

## 4. Use it

- **Siri**: "Hey Siri, Add to Tally" → dictate the task
- **Home screen**: long-press the Shortcuts widget → add the shortcut
- **Share sheet**: enable *Show in Share Sheet* in the shortcut's settings
- **Back Tap**: Settings → Accessibility → Touch → Back Tap → Double Tap → your shortcut

## Natural language still works

The SQL function can't run the app's TypeScript parser, so captured text is
stored raw and tagged `inbox`. Next time you open Tally it re-parses that text
with the same parser the composer uses, then clears the tag.

So dictating *"read Dune 4pm"* gives you a task called **read Dune** at 16:00 —
the parse just happens on next open rather than instantly.

## Troubleshooting

| Response | Meaning |
|---|---|
| `{"ok":true,...}` | Worked. The task is on today's list. |
| `unauthorized` | Token is wrong, or was deleted. |
| `empty task` | No text was sent — check the `p_text` variable is wired up. |
| `401` / `No API key found` | The `apikey` header is missing or wrong. |

The task always lands on **today** in the server's reckoning of the date. If you
capture something just before midnight while travelling, it may land a day off —
open the app and drag it, or say "tomorrow" in the text.
