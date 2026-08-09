import Dexie, { type EntityTable } from 'dexie'
import type { ISODate } from '../lib/date'

/** Local database name. Deliberately distinct from the pre-sync `tally` DB,
 *  whose integer keys are incompatible with cross-device ids; that one is
 *  deleted on boot (see `dropLegacyDatabase`). */
const DB_NAME = 'tally-sync'

/** Fields every synced row carries.
 *
 *  `updatedAt` drives last-write-wins merges. `deleted` is a tombstone — rows
 *  are never hard-deleted locally, because a hard delete cannot propagate to
 *  the other device. `dirty` is local-only bookkeeping and is stripped before
 *  anything is sent to the server. */
export interface Synced {
  id: string
  updatedAt: number
  deleted: 0 | 1
  dirty: 0 | 1
}

export interface Task extends Synced {
  date: ISODate
  time: string
  tag: string
  title: string
  done: boolean
  order: number
  /** Set when this task was materialised from a Recurrence. */
  recurrenceId?: string
  /** Set on a sub-task, pointing at its parent task's id. One level only —
   *  deeper nesting buys little and complicates every read path. */
  parentId?: string
  /** The date this task was originally due, set when it is rolled forward for
   *  being incomplete. Drives the overdue styling; cleared on completion. */
  overdueFrom?: ISODate
}

export interface Habit extends Synced {
  name: string
  /** Uppercase short form used by the tally cards and the habit grid header. */
  short: string
  order: number
}

/** id is `${date}:${habitId}` — one log per habit per day, by construction, so
 *  two devices ticking the same habit converge instead of duplicating. */
export interface HabitLog extends Synced {
  date: ISODate
  habitId: string
  done: boolean
}

/** id is the ISO date. */
export interface DailyMetric extends Synced {
  date: ISODate
  weight?: number
  hours?: number
  screen?: number
}

export type Horizon = 'quarter' | 'month' | 'week'

export interface Goal extends Synced {
  horizon: Horizon
  /** Period this goal belongs to, e.g. "Q1 2026" / "February" / "3 — 9 Aug". */
  label: string
  title: string
  current: number
  target: number
  unit: string
  order: number
  /** Set when this goal was materialised from a Recurrence. */
  recurrenceId?: string
}

/** id is the ISO date. */
export interface JournalEntry extends Synced {
  date: ISODate
  best: string
}

export type RepeatRule = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'quarterly'

/** A template that materialises into real tasks or goals, one per period.
 *
 *  Instances are never generated ahead of time — opening a date creates only
 *  what that date needs, with the deterministic id `<recurrenceId>:<period>`.
 *  Two devices therefore produce byte-identical instances instead of duplicates,
 *  and a tombstoned instance stays deleted because its id is already taken. */
export interface Recurrence extends Synced {
  kind: 'task' | 'goal'
  rule: RepeatRule
  title: string
  /** Task fields. */
  time: string
  tag: string
  /** Goal fields. */
  horizon: Horizon
  target: number
  unit: string
  /** Instances are never created before this date. */
  startDate: ISODate
  /** 0 = Sunday … 6 = Saturday. Only meaningful when rule is 'weekly'. */
  weekday: number
}

export interface Setting {
  key: string
  value: string
}

export type SyncedTable =
  | 'tasks'
  | 'habits'
  | 'habitLogs'
  | 'metrics'
  | 'goals'
  | 'journal'
  | 'recurrences'

export const SYNCED_TABLES: SyncedTable[] = [
  'tasks',
  'habits',
  'habitLogs',
  'metrics',
  'goals',
  'journal',
  'recurrences',
]

/** Local table name -> Postgres table name. */
export const REMOTE_TABLE: Record<SyncedTable, string> = {
  tasks: 'tasks',
  habits: 'habits',
  habitLogs: 'habit_logs',
  metrics: 'metrics',
  goals: 'goals',
  journal: 'journal',
  recurrences: 'recurrences',
}

const db = new Dexie(DB_NAME) as Dexie & {
  tasks: EntityTable<Task, 'id'>
  habits: EntityTable<Habit, 'id'>
  habitLogs: EntityTable<HabitLog, 'id'>
  metrics: EntityTable<DailyMetric, 'id'>
  goals: EntityTable<Goal, 'id'>
  journal: EntityTable<JournalEntry, 'id'>
  recurrences: EntityTable<Recurrence, 'id'>
  settings: EntityTable<Setting, 'key'>
}

db.version(1).stores({
  tasks: 'id, date, dirty, updatedAt',
  habits: 'id, order, dirty, updatedAt',
  habitLogs: 'id, date, habitId, dirty, updatedAt',
  metrics: 'id, date, dirty, updatedAt',
  goals: 'id, horizon, dirty, updatedAt',
  journal: 'id, date, dirty, updatedAt',
  settings: 'key',
})

db.version(2).stores({
  recurrences: 'id, kind, dirty, updatedAt',
})

export { db }

/** The pre-sync build stored auto-increment keys in a database named `tally`.
 *  Those rows cannot be reconciled across devices, and the user asked for a
 *  clean start, so it is removed outright. */
export async function dropLegacyDatabase(): Promise<void> {
  try {
    await Dexie.delete('tally')
  } catch {
    // A blocked delete (another tab holding the old DB open) is not worth
    // failing startup over — the new database is separate either way.
  }
}

export function newId(): string {
  return crypto.randomUUID()
}

export function habitLogId(date: ISODate, habitId: string): string {
  return `${date}:${habitId}`
}

/** Stamp a record as locally changed and awaiting push. */
export function touch<T extends object>(patch: T): T & Pick<Synced, 'updatedAt' | 'dirty'> {
  return { ...patch, updatedAt: Date.now(), dirty: 1 }
}

/** Day rating, 0–10, derived from the day's task and habit completion.
 *  The design labels this "Auto from tasks + habits"; the split is even. */
export function dayRating(
  tasksDone: number,
  tasksTotal: number,
  habitsDone: number,
  habitsTotal: number,
): number | null {
  const parts: number[] = []
  if (tasksTotal > 0) parts.push(tasksDone / tasksTotal)
  if (habitsTotal > 0) parts.push(habitsDone / habitsTotal)
  if (parts.length === 0) return null
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length
  return Math.round(avg * 100) / 10
}
