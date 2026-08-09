# Tally

A life tracker — tasks, habits, goals, metrics and a journal in one place, built
from the `Tally.dc.html` design in the *Life tracking unified app* Claude Design
project.

Local-first: the UI only ever reads the on-device database, so it is instant and
works offline. A background sync engine reconciles that database with Supabase,
which is what keeps your iPhone and your Mac showing the same thing.

One codebase, two form factors and two themes:

- **Mobile** (< 900px) — header, scroller, bottom tab bar. The Today tab carries
  a `Today / Calendar / Journal` segmented control.
- **Desktop** (≥ 900px) — sidebar, task list, and a journal rail on the right.
  The rail collapses below 1180px.
- **Themes** — the design was authored as two complete palettes over one
  structure, and both ship: `dark` (orange `#FF5A1F`, Doto dot-matrix labels,
  squared checkboxes) and `light` (system blue `#007AFF`, SF Pro, circular
  checkboxes, Apple grouped-list grammar). Toggle in the sidebar, or from the
  header on any non-Today mobile screen.

## Setup

### 1. Install

```bash
bun install
```

### 2. Create the Supabase project

This is the one step I can't do for you — it needs your account.

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   That creates the six tables, the row-level security policies, and the
   realtime publication. It's idempotent, so re-running it is safe.
3. **Authentication → Sign In / Providers** → make sure **Email** is enabled.
   Turn *Confirm email* on; passwords aren't used.
4. **Authentication → URL Configuration** → add your app's URL (and
   `http://localhost:5173` for development) to **Redirect URLs**. Magic links
   will not return to the app without this.

### 3. Configure credentials

```bash
cp .env.example .env.local
```

Fill in from **Project Settings → Data API** (URL) and **Project Settings → API
Keys** (anon/publishable key). The anon key is meant to be public — row-level
security is what protects the data.

> **These are baked in at build time, not read at runtime.** A build made
> without them produces a local-only app (and is ~200 KB smaller, because
> Supabase gets tree-shaken out). Your hosting provider must have both variables
> set in its build environment.

### 4. Run

```bash
bun run dev
```

```bash
bun run build
```

## Installing on your devices

The app is a PWA, so installing is the same act everywhere: open the URL, then
install from the browser.

**macOS**
- Safari 17+: `File → Add to Dock`
- Chrome/Edge: install icon in the address bar

**iPhone**
- Safari: `Share → Add to Home Screen`

> On iOS you **must** add it to the Home Screen. Safari evicts IndexedDB for
> ordinary websites after ~7 days without interaction; installed PWAs are exempt.
> A bookmark is not enough.

## Deployment

Live at **https://tally-ahmed7aks-projects.vercel.app** (Vercel project
`ahmed7aks-projects/tally`).

```bash
vercel deploy --prod
```

`vercel.json` pins the cache headers that matter for a PWA: hashed assets are
immutable for a year, while `sw.js`, `registerSW.js`, `index.html` and the
manifest must revalidate — a cached service worker would otherwise pin installed
devices to an old build.

Vercel Authentication (`ssoProtection`) is **disabled** on this project. It has
to be: Safari cannot fetch a login-walled manifest or service worker, so the PWA
would not install. Access control is the app's own magic-link sign-in, and
row-level security on the database.

Remember that the two `VITE_` variables are read at build time. After changing
them in Vercel you must redeploy — the running deployment will not pick them up.

## Signing in

Email and password, via Supabase Auth. The screen toggles between **Sign in**
and **Create account**; passwords are hashed server-side by Supabase and never
stored by the app.

Sign in with the same account on both devices and they share one dataset.
Signing out wipes the local cache, so a second account on a shared device never
sees the first one's rows.

Passwords rather than magic links because the built-in Supabase email service is
capped at ~2 messages an hour and is for testing only — that limit makes email
sign-in painful to set up and fragile to recover. Passwords need no email
delivery at all, which also means **Site URL and Redirect URLs are irrelevant**
to sign-in here.

> If **Confirm email** is enabled in Supabase (Authentication → Sign In /
> Providers → Email), a new account is created but issues no session until it is
> confirmed — the app says so explicitly. Either turn that setting off, or
> confirm the user under **Authentication → Users**.

## How sync works

| Step | Behaviour |
|---|---|
| **push** | Every locally-changed row (`dirty = 1`) is upserted, then un-dirtied — but only if it hasn't changed again mid-flight. |
| **pull** | Rows with `updated_at` newer than a per-table watermark are fetched, paged 1000 at a time. |
| **merge** | Last-write-wins on `updatedAt`. Ties keep the local row, so re-pulling what you just pushed is a no-op rather than a write loop. |
| **realtime** | A Postgres change on one device merges into the other within a second, without waiting for a poll. |
| **triggers** | App start, sign-in, coming back online, tab becoming visible, and ~1s after any edit (debounced). |

Deletes are **tombstones** (`deleted = 1`), never hard deletes — a hard delete
can't propagate to a device that's currently offline.

Conflicts are mostly designed away rather than resolved. Rows that are naturally
one-per-day carry deterministic ids, so two devices can't create duplicates:

| Table | id |
|---|---|
| `tasks`, `habits`, `goals` | random UUID |
| `metrics`, `journal` | the ISO date |
| `habitLogs` | `<date>:<habitId>` |

Offline edits queue up as dirty rows and flush on reconnect. The status pill in
the sidebar shows `Synced` / `Syncing…` / `Offline — saved locally` / `Sync
failed`, and clicking it offers a manual retry and sign-out.

If you never configure Supabase, none of this engages: no sign-in gate, no
network calls, data stays in the browser.

## Quick capture

The composer sits at the **top** of the task list so it never drifts below the
fold, and keeps focus after each submit so several tasks can be typed in a row.
Escape clears it.

Text is parsed as you type, TickTick style, with a live preview of what will be
saved:

| You type | Saves as |
|---|---|
| `read Dune 4pm` | **read Dune** at 16:00 |
| `gym 6:30am` | **gym** at 06:30 |
| `standup 16:00` | **standup** at 16:00 |
| `call mum tomorrow 9am` | **call mum**, tomorrow, 09:00 |
| `gym monday` | **gym**, on the coming Monday |
| `gym next monday` | **gym**, a week later |
| `read 4 pages` | **read 4 pages** — no time |

The parser is deliberately conservative (`src/lib/parse.ts`): bare numbers are
never times, and the day abbreviations that double as common nouns — `sun`,
`sat` — only count after `on`/`this`/`next`, so "sit in the sun" survives
intact. Anything it does claim is shown in the preview before you commit.

Timed tasks sort chronologically above untimed ones.

## Sound

Completing anything — a task, a habit, a weekly goal — plays a short bell.
It's synthesised with the Web Audio API (`src/lib/sound.ts`), so there's no
audio file to download and it works offline. Un-completing is silent.

Toggle it in the sidebar; the setting persists. iOS only permits audio to start
from a user gesture, so the context is created lazily inside the tap that needs
it.

## Data

| Table | Key | Holds |
|---|---|---|
| `tasks` | uuid | date, time, tag, title, done, order |
| `habits` | uuid | name, short (grid column header), order |
| `habitLogs` | `date:habitId` | date, habitId, done |
| `metrics` | date | weight, hours, screen |
| `goals` | uuid | horizon (quarter/month/week), label, title, current, target, unit |
| `journal` | date | best — the "best part of today" reflection |

Every synced row also carries `updatedAt`, `deleted`, and a local-only `dirty`
flag that is stripped before anything is sent.

**Day rating** is derived, never stored: the mean of task completion and habit
completion for that day, scaled to 0–10. A day with nothing recorded is
*unrated* rather than zero, so empty future days don't drag monthly averages
down.

## Layout

```
src/
  App.tsx              shell, routing, theme, responsive switch, auth gate
  main.tsx             entry
  auth/
    AuthProvider.tsx   session context, magic link, sign-out
  sync/
    sync.ts            push / pull / merge / realtime
  db/
    db.ts              Dexie schema, id helpers, dayRating
    hooks.ts           live queries and mutations
  lib/
    date.ts            local-time ISO date helpers
    supabase.ts        client (null when unconfigured)
  components/
    ui.tsx             Label, Check, Ring, Spark, Bar
    JournalRail.tsx    rating, tally, week checks, reflection
    SyncStatus.tsx     status pill, manual sync, sign out
    Install.tsx        install prompt / per-browser hint
  screens/             SignIn, Today, Habits, Goals, Metrics, Review, Calendar
  styles/
    tokens.css         both palettes as custom properties
    app.css            layout and components
supabase/
  schema.sql           tables, RLS, realtime — run once
```

## Notes

- Dates are `YYYY-MM-DD` strings computed in local time throughout. Never UTC —
  the day would flip at the wrong hour.
- `updatedAt` is epoch milliseconds written by the client, not a server default,
  because both devices must agree on what it means for last-write-wins to work.
  A badly-wrong device clock would therefore win conflicts it shouldn't.
- Metrics charts read trailing windows (30 and 14 days), not the calendar month,
  so they never open near-empty on the 1st.
- The pre-sync build's seeded database (`tally`) is deleted automatically on
  first load; the current one is `tally-sync`.
