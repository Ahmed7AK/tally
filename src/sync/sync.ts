import type { RealtimeChannel } from '@supabase/supabase-js'
import { db, REMOTE_TABLE, SYNCED_TABLES, type Synced, type SyncedTable } from '../db/db'
import { supabase } from '../lib/supabase'

/* ---------------------------------------------------------------------------
   Local-first sync.

   The UI only ever reads Dexie. This module reconciles Dexie with Postgres:

     push  — every row with dirty = 1 is upserted, then un-dirtied.
     pull  — every remote row with updated_at > the local watermark is merged.
     merge — last-write-wins on updatedAt. Ties keep the local row, which makes
             the operation idempotent: re-pulling what we just pushed is a
             no-op rather than a write loop.

   Deletes are tombstones (deleted = 1), so they propagate like any other edit.
   --------------------------------------------------------------------------- */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled'

type Listener = (state: SyncState, detail?: string) => void

const listeners = new Set<Listener>()
let state: SyncState = supabase ? 'idle' : 'disabled'
let detail: string | undefined
let userId: string | null = null
let channel: RealtimeChannel | null = null

let running = false
let queued = false
let debounce: ReturnType<typeof setTimeout> | null = null

function setState(next: SyncState, why?: string) {
  state = next
  detail = why
  for (const l of listeners) l(next, why)
}

export function onSyncStateChange(l: Listener): () => void {
  listeners.add(l)
  l(state, detail)
  return () => listeners.delete(l)
}

export function getSyncState(): { state: SyncState; detail?: string } {
  return { state, detail }
}

/* --- watermark ------------------------------------------------------------- */
/* The cursor is `synced_at`, assigned by a Postgres sequence (migration 010),
 * *not* `updated_at`. `updated_at` is a client clock, so paging on it means
 * storing a watermark read off another device's clock: a phone running a
 * minute fast permanently hides every edit the laptop makes inside that
 * minute, because those rows carry a lower `updated_at` than the watermark
 * and `updated_at > watermark` stops returning them. A sequence has no such
 * failure mode — it only increases and never ties.
 *
 * The key is deliberately new, so upgrading devices re-pull from zero once and
 * recover anything the old clock-based cursor skipped past. */

const WATERMARK_KEY = (t: SyncedTable) => `cursor:${t}`

/** Server-assigned. Sent back on a push would be meaningless — the trigger
 *  overwrites it — so it is stripped alongside `dirty`. */
const CURSOR = 'synced_at'

async function getWatermark(table: SyncedTable): Promise<number> {
  const row = await db.settings.get(WATERMARK_KEY(table))
  return row ? Number(row.value) : 0
}

async function setWatermark(table: SyncedTable, value: number): Promise<void> {
  await db.settings.put({ key: WATERMARK_KEY(table), value: String(value) })
}

/* --- field mapping --------------------------------------------------------- */
/* Local rows are camelCase; Postgres columns are snake_case.
 *
 * This was previously a hand-written lookup of the two fields that differed.
 * Every field added afterwards — parentId, recurrenceId, overdueFrom,
 * startDate — was silently sent through unconverted, and PostgREST rejected
 * the whole push with "Could not find the 'parentId' column". Deriving the
 * conversion removes the entire class of bug: a new camelCase field is
 * translated whether or not anyone remembers to update a table. */

const toSnake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (key: string): string => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function toRemote(row: Record<string, unknown>, uid: string): Record<string, unknown> {
  const out: Record<string, unknown> = { user_id: uid }
  for (const [k, v] of Object.entries(row)) {
    if (k === 'dirty' || k === 'syncedAt') continue // not ours to send
    // undefined would be sent as null and clobber a value another device set.
    if (v === undefined) continue
    out[toSnake(k)] = v
  }
  return out
}

function toLocal(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id') continue
    // Postgres returns NULL for unset optional columns; local rows just omit
    // them, and an explicit null would defeat `?? fallback` reads.
    out[toCamel(k)] = v === null ? undefined : v
  }
  // Rows arriving from the server are, by definition, already pushed.
  out.dirty = 0
  return out
}

/* --- push / pull ----------------------------------------------------------- */

async function pushTable(table: SyncedTable, uid: string): Promise<void> {
  const dirty = await db.table(table).where('dirty').equals(1).toArray()
  if (dirty.length === 0) return

  // Chunked so a large first sync doesn't exceed the request size limit.
  const CHUNK = 500
  for (let i = 0; i < dirty.length; i += CHUNK) {
    const batch = dirty.slice(i, i + CHUNK)
    const { error } = await supabase!
      .from(REMOTE_TABLE[table])
      .upsert(batch.map((r) => toRemote(r, uid)), { onConflict: 'user_id,id' })
    if (error) throw new Error(`push ${table}: ${error.message}`)

    // Clear dirty only for rows that have not changed again mid-flight.
    await db.transaction('rw', db.table(table), async () => {
      for (const row of batch) {
        const current = await db.table(table).get(row.id)
        if (current && current.updatedAt === row.updatedAt) {
          await db.table(table).update(row.id, { dirty: 0 })
        }
      }
    })
  }
}

async function pullTable(table: SyncedTable, uid: string): Promise<void> {
  const since = await getWatermark(table)
  const PAGE = 1000
  let high = since

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase!
      .from(REMOTE_TABLE[table])
      .select('*')
      .eq('user_id', uid)
      .gt(CURSOR, since)
      .order(CURSOR, { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`pull ${table}: ${error.message}`)
    if (!data || data.length === 0) break

    await mergeRows(table, data as Record<string, unknown>[])
    // Safe as a strict `>` next time round: the sequence never repeats, so a
    // full page can never straddle two rows sharing a cursor and drop one.
    high = Math.max(high, Number(data[data.length - 1][CURSOR]))
    if (data.length < PAGE) break
  }

  if (high > since) await setWatermark(table, high)
}

/** Last-write-wins merge. A remote row only lands if it is strictly newer than
 *  what we hold, so a local edit made while the pull was in flight survives. */
async function mergeRows(table: SyncedTable, rows: Record<string, unknown>[]): Promise<void> {
  const mapped = rows.map(toLocal) as (Synced & Record<string, unknown>)[]
  await db.transaction('rw', db.table(table), async () => {
    for (const incoming of mapped) {
      const local = (await db.table(table).get(incoming.id)) as Synced | undefined
      if (!local || incoming.updatedAt > local.updatedAt) {
        await db.table(table).put(incoming)
      }
    }
  })
}

/* --- hydration gate --------------------------------------------------------- */
/* Rollover and materialisation are mechanical writes: they move an unfinished
 * task to today, or mint a recurring instance. Both stamp a *fresh* updatedAt,
 * which under last-write-wins outranks anything older — including a real edit
 * made on another device that we have not pulled yet.
 *
 * Run them on a cold start and that is exactly what happens. The phone opens
 * in the morning holding yesterday's copy of a task the laptop finished (or
 * deleted) last night, rollover fires before the first pull lands, and the
 * task is rewritten as undone, dated today, overdueFrom yesterday. The pull
 * then arrives with the genuine edit, loses the comparison by a few hundred
 * milliseconds, and is discarded — and the phone pushes the resurrected row
 * back out, so the laptop loses it too. The task reads "1 day late" on both
 * devices no matter what was actually done to it.
 *
 * So: nothing derived writes until the first pull has settled. */

const HYDRATE_TIMEOUT = 8000

let hydrated: Promise<void> = Promise.resolve()
let markHydrated: () => void = () => {}

function resetHydration(): void {
  if (!supabase) {
    hydrated = Promise.resolve()
    markHydrated = () => {}
    return
  }
  let settled = false
  hydrated = new Promise<void>((resolve) => {
    markHydrated = () => {
      if (settled) return
      settled = true
      resolve()
    }
    // A gate that can hang is worse than the race it prevents: offline, or on
    // a server that never answers, the app still has to be usable. Waiting is
    // bounded, and timing out just restores the old behaviour.
    setTimeout(() => markHydrated(), HYDRATE_TIMEOUT)
  })
}

resetHydration()

/** Resolves once the first sync pass since sign-in has finished — successfully
 *  or not. Anything that writes *derived* state should await this first, so it
 *  reasons about the other device's edits instead of racing them. */
export function whenHydrated(): Promise<void> {
  return hydrated
}

/* --- orchestration --------------------------------------------------------- */

async function runSync(): Promise<void> {
  if (!supabase || !userId) return
  if (running) {
    queued = true
    return
  }
  if (!navigator.onLine) {
    setState('offline')
    // Offline is a settled answer, not a pending one — don't strand the gate.
    markHydrated()
    return
  }

  running = true
  setState('syncing')
  try {
    // Push first: local intent should win a same-round race against the
    // watermark, and pushed rows come back as no-ops on the pull.
    for (const table of SYNCED_TABLES) await pushTable(table, userId)
    for (const table of SYNCED_TABLES) await pullTable(table, userId)
    setState('idle')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setState(navigator.onLine ? 'error' : 'offline', message)
    console.error('sync failed', err)
  } finally {
    running = false
    markHydrated()
    if (queued) {
      queued = false
      void runSync()
    }
  }
}

/** Coalescing entry point. Safe to call on every keystroke. */
export function requestSync(delay = 900): void {
  if (!supabase || !userId) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void runSync()
  }, delay)
}

/** Force an immediate pass, bypassing the debounce. */
export function syncNow(): Promise<void> {
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
  return runSync()
}

/* --- lifecycle ------------------------------------------------------------- */

function subscribeRealtime(uid: string) {
  if (!supabase) return
  channel = supabase.channel(`tally:${uid}`)
  for (const table of SYNCED_TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: REMOTE_TABLE[table], filter: `user_id=eq.${uid}` },
      (payload) => {
        const row = payload.new as Record<string, unknown> | null
        if (!row || !row.id) return
        void mergeRows(table, [row])
      },
    )
  }
  channel.subscribe()
}

let wired = false

function wireGlobalTriggers() {
  if (wired) return
  wired = true
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('offline', () => setState('offline'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
}

/** Called when a session appears. Starts realtime and runs a first pass. */
export async function startSync(uid: string): Promise<void> {
  if (!supabase) return
  if (userId === uid) return
  await stopSync()
  userId = uid
  wireGlobalTriggers()
  subscribeRealtime(uid)
  await syncNow()
}

/** Called on sign-out. Drops the realtime channel and the local cache, so the
 *  next account to sign in on this device starts clean. */
export async function stopSync(): Promise<void> {
  if (channel && supabase) {
    await supabase.removeChannel(channel)
    channel = null
  }
  userId = null
  resetHydration()
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
  setState(supabase ? 'idle' : 'disabled')
}

/** Wipes every local table and watermark. Used on sign-out so one account's
 *  data is never visible to the next, and by "start over" in settings. */
export async function clearLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.tasks, db.habits, db.habitLogs, db.metrics, db.goals, db.journal, db.settings],
    async () => {
      await Promise.all([
        db.tasks.clear(),
        db.habits.clear(),
        db.habitLogs.clear(),
        db.metrics.clear(),
        db.goals.clear(),
        db.journal.clear(),
        db.settings.clear(),
      ])
    },
  )
}
