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
   *  being incomplete. Drives the overdue styling.
   *
   *  Cleared on completion by writing `null`, not by removing the key: Dexie
   *  deletes a key assigned undefined, and a field the row does not have is a
   *  field the push cannot clear on the server. Reads use `??`/truthiness, so
   *  null and absent behave alike locally. */
  overdueFrom?: ISODate | null
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
  /** Set when this goal belongs to a Topic rather than to you directly. */
  topicId?: string
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
  /** Carried onto materialised goals so a repeating topic goal stays with its
   *  topic instead of reappearing in the personal list. */
  topicId?: string
}

/** A commitment, organisation or area of responsibility that owns its own set
 *  of goals — separate from your personal ones, so a quarter goal for a club
 *  doesn't sit in the same list as a quarter goal for your training. */
export interface Topic extends Synced {
  name: string
  /** Your role in it, e.g. "Treasurer", "Founder". */
  position: string
  summary: string
  order: number
  /** Unguessable token in the share URL. Rotating it invalidates old links. */
  shareToken?: string
  /** 0/1 rather than boolean, matching `deleted`. */
  shared: 0 | 1
  /** Whether viewers see the numbers, or only which goals are done. */
  shareProgress: 0 | 1
  shareSummary: 0 | 1
}

export interface Setting {
  key: string
  value: string
}

export type SyncedTable =
  | 'topics'
  | 'tasks'
  | 'habits'
  | 'habitLogs'
  | 'metrics'
  | 'goals'
  | 'journal'
  | 'recurrences'

/** Topics lead: goals reference them, so pulling a topic before the goals that
 *  point at it avoids a window where a goal has nowhere to appear. */
export const SYNCED_TABLES: SyncedTable[] = [
  'topics',
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
  topics: 'topics',
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
  topics: EntityTable<Topic, 'id'>
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

db.version(3).stores({
  topics: 'id, order, dirty, updatedAt',
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

/** What a full day of focused work looks like, in hours. The work score is
 *  measured against this, so a short day cannot read as a perfect one. */
export const TARGET_HOURS = 8

/** Weights of the two halves of the rating. Work leads; habits adjust. */
const WORK_WEIGHT = 0.7
const HABIT_WEIGHT = 0.3

export interface DayRatingInput {
  /** Hours worked, as logged in the day's metrics. Undefined when unlogged. */
  hours?: number
  /** Screen time for the day. Undefined when unlogged. */
  screen?: number
  habitsDone: number
  habitsTotal: number
}

/** Day rating, 0–10, from hours worked against screen time, plus habits.
 *
 *  Task completion is deliberately not an input. The to-do list is edited as
 *  the day goes — unfinished items get deleted and rewritten for tomorrow — so
 *  "tasks done / tasks total" measures how the list was tidied, not how the day
 *  went, and it trends toward a meaningless 100%.
 *
 *  The work half combines two things that are each useless alone:
 *
 *    balance — worked / (worked + screen). How the day actually split.
 *    volume  — worked / TARGET_HOURS. Whether there was much of a day at all.
 *
 *  They are combined as a geometric mean rather than an average, so neither can
 *  carry the score by itself: one hour of work with zero screen time is perfect
 *  balance but still only one hour, and it lands near 3.5 rather than 10.
 *
 *  A component with nothing recorded is dropped and the remaining weight is
 *  renormalised, so an unlogged day is unrated rather than a zero. */
export function dayRating({
  hours,
  screen,
  habitsDone,
  habitsTotal,
}: DayRatingInput): number | null {
  const parts: { value: number; weight: number }[] = []

  // Either field on its own is enough to score the day: logging four hours of
  // screen time and no work is a real signal, not missing data.
  if (hours !== undefined || screen !== undefined) {
    const worked = hours ?? 0
    const burned = screen ?? 0
    const tracked = worked + burned
    const balance = tracked > 0 ? worked / tracked : 0
    const volume = Math.min(1, worked / TARGET_HOURS)
    parts.push({ value: Math.sqrt(balance * volume), weight: WORK_WEIGHT })
  }

  if (habitsTotal > 0) parts.push({ value: habitsDone / habitsTotal, weight: HABIT_WEIGHT })

  if (parts.length === 0) return null
  const total = parts.reduce((a, p) => a + p.weight, 0)
  const score = parts.reduce((a, p) => a + p.value * p.weight, 0) / total
  return Math.round(score * 100) / 10
}
