import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  dayRating,
  habitLogId,
  newId,
  touch,
  type DailyMetric,
  type Goal,
  type Habit,
  type HabitLog,
  type Horizon,
  type Recurrence,
  type Synced,
  type Task,
  type Topic,
} from './db'
import { addDays, monthDates, today as realToday, type ISODate } from '../lib/date'
import { parseTaskInput } from '../lib/parse'
import { chronologicalIndex, needsRebalance, orderAtEnd, orderBetween, rebalanced } from '../lib/order'
import {
  HORIZON_FOR_RULE,
  instanceId,
  periodKey,
  periodLabel,
  periodStart,
  taskAppliesOn,
} from '../lib/recur'
import { requestSync } from '../sync/sync'

/** Tombstoned rows stay in the table so their deletion can propagate; every
 *  read path filters them out. */
const live = <T extends { deleted: 0 | 1 }>(rows: T[]): T[] => rows.filter((r) => !r.deleted)

/** Manual order is the only sort. Time no longer overrides it, because a
 *  chronological sort would silently undo any drag; instead a newly added timed
 *  task is *inserted* at its chronological position, so the default still comes
 *  out in clock order and dragging still sticks. */
const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order

/** Top-level tasks for the day. Sub-tasks are fetched separately by parent. */
export function useTasks(date: ISODate): Task[] {
  return (
    useLiveQuery(
      async () =>
        live(await db.tasks.where('date').equals(date).toArray())
          .filter((t) => !t.parentId)
          .sort(byOrder),
      [date],
      [],
    ) ?? []
  )
}

/** Sub-tasks for the day, grouped by parent id. */
export function useSubtasks(date: ISODate): Record<string, Task[]> {
  return (
    useLiveQuery(
      async () => {
        const rows = live(await db.tasks.where('date').equals(date).toArray()).filter(
          (t) => t.parentId,
        )
        const out: Record<string, Task[]> = {}
        for (const t of rows) {
          ;(out[t.parentId!] ??= []).push(t)
        }
        for (const list of Object.values(out)) list.sort((a, b) => a.order - b.order)
        return out
      },
      [date],
      {},
    ) ?? {}
  )
}

export function useHabits(): Habit[] {
  return useLiveQuery(async () => live(await db.habits.toArray()).sort((a, b) => a.order - b.order), [], []) ?? []
}

export function useHabitLogs(date: ISODate): Record<string, boolean> {
  return (
    useLiveQuery(
      async () => {
        const logs = live(await db.habitLogs.where('date').equals(date).toArray())
        return Object.fromEntries(logs.map((l) => [l.habitId, l.done]))
      },
      [date],
      {},
    ) ?? {}
  )
}

export function useMetric(date: ISODate): DailyMetric | undefined {
  return useLiveQuery(async () => {
    const row = await db.metrics.get(date)
    return row && !row.deleted ? row : undefined
  }, [date])
}

export function useJournal(date: ISODate) {
  return useLiveQuery(async () => {
    const row = await db.journal.get(date)
    return row && !row.deleted ? row : undefined
  }, [date])
}

export function useGoals(): Goal[] {
  return useLiveQuery(async () => live(await db.goals.toArray()).sort((a, b) => a.order - b.order), [], []) ?? []
}

/** Task + habit completion and derived rating for a single day. */
export function useDaySummary(date: ISODate) {
  const tasks = useTasks(date)
  const habits = useHabits()
  const logs = useHabitLogs(date)

  const tasksDone = tasks.filter((t) => t.done).length
  const habitsDone = habits.filter((h) => logs[h.id]).length
  return {
    tasks,
    habits,
    logs,
    tasksDone,
    tasksTotal: tasks.length,
    habitsDone,
    habitsTotal: habits.length,
    rating: dayRating(tasksDone, tasks.length, habitsDone, habits.length),
  }
}

/** Ratings for the last `n` days, oldest first. */
export function useRatingSeries(endDate: ISODate, n: number) {
  return (
    useLiveQuery(
      async () => {
        const dates = Array.from({ length: n }, (_, i) => addDays(endDate, -(n - 1 - i)))
        const habitCount = live(await db.habits.toArray()).length
        const [allTasks, allLogs] = await Promise.all([
          db.tasks.where('date').anyOf(dates).toArray(),
          db.habitLogs.where('date').anyOf(dates).toArray(),
        ])
        const byDateTasks = new Map<string, Task[]>()
        for (const t of live(allTasks)) {
          const arr = byDateTasks.get(t.date) ?? []
          arr.push(t)
          byDateTasks.set(t.date, arr)
        }
        const byDateLogs = new Map<string, HabitLog[]>()
        for (const l of live(allLogs)) {
          const arr = byDateLogs.get(l.date) ?? []
          arr.push(l)
          byDateLogs.set(l.date, arr)
        }
        return dates.map((d) => {
          const ts = byDateTasks.get(d) ?? []
          const ls = byDateLogs.get(d) ?? []
          // A day with nothing recorded is unrated, not a zero — otherwise
          // future days drag every average down.
          if (ts.length === 0 && ls.length === 0) return { date: d, rating: null }
          return {
            date: d,
            rating: dayRating(
              ts.filter((t) => t.done).length,
              ts.length,
              ls.filter((l) => l.done).length,
              habitCount,
            ),
          }
        })
      },
      [endDate, n],
      [],
    ) ?? []
  )
}

/** Metric rows for the `n` days ending at `endDate`, oldest first. Charts use
 *  this rather than the calendar month so they never open on a near-empty
 *  window on the 1st. */
export function useTrailingMetrics(endDate: ISODate, n: number) {
  return (
    useLiveQuery(
      async () => {
        const dates = Array.from({ length: n }, (_, i) => addDays(endDate, -(n - 1 - i)))
        const rows = live(await db.metrics.where('date').anyOf(dates).toArray())
        const map = new Map(rows.map((r) => [r.date, r]))
        return dates.map((d) => ({ date: d, ...(map.get(d) ?? {}) }))
      },
      [endDate, n],
      [],
    ) ?? []
  )
}

/** Every metric row for the month containing `date`, oldest first. */
export function useMonthMetrics(date: ISODate) {
  return (
    useLiveQuery(
      async () => {
        const dates = monthDates(date)
        const rows = live(await db.metrics.where('date').anyOf(dates).toArray())
        const map = new Map(rows.map((r) => [r.date, r]))
        return dates.map((d) => ({ date: d, ...(map.get(d) ?? {}) }))
      },
      [date],
      [],
    ) ?? []
  )
}

/** Habit ticks for the month, as `date -> habitId -> done`. */
export function useMonthHabitLogs(date: ISODate): Record<string, Record<string, boolean>> {
  return (
    useLiveQuery(
      async () => {
        const dates = monthDates(date)
        const logs = live(await db.habitLogs.where('date').anyOf(dates).toArray())
        const out: Record<string, Record<string, boolean>> = {}
        for (const l of logs) {
          out[l.date] ??= {}
          out[l.date][l.habitId] = l.done
        }
        return out
      },
      [date],
      {},
    ) ?? {}
  )
}

/** Per-day task counts for the month — drives the calendar dots. */
export function useMonthTaskCounts(date: ISODate): Record<string, { total: number; done: number }> {
  return (
    useLiveQuery(
      async () => {
        const dates = monthDates(date)
        const tasks = live(await db.tasks.where('date').anyOf(dates).toArray())
        const out: Record<string, { total: number; done: number }> = {}
        for (const t of tasks) {
          out[t.date] ??= { total: 0, done: 0 }
          out[t.date].total++
          if (t.done) out[t.date].done++
        }
        return out
      },
      [date],
      {},
    ) ?? {}
  )
}

export function useMonthJournal(date: ISODate) {
  return (
    useLiveQuery(
      async () => {
        const dates = monthDates(date)
        const rows = live(await db.journal.where('date').anyOf(dates).toArray())
        return rows.filter((r) => r.best.trim()).sort((a, b) => a.date.localeCompare(b.date))
      },
      [date],
      [],
    ) ?? []
  )
}

export function useTopics(): Topic[] {
  return useLiveQuery(async () => live(await db.topics.toArray()).sort(byOrder), [], []) ?? []
}

export async function addTopic(name: string, position: string, summary: string) {
  const existing = live(await db.topics.toArray())
  await db.topics.add({
    id: newId(),
    name,
    position,
    summary,
    order: orderAtEnd(existing.map((t) => t.order)),
    deleted: 0,
    ...touch({}),
  })
  requestSync()
}

export async function updateTopic(id: string, patch: Partial<Topic>) {
  await db.topics.update(id, touch(patch))
  requestSync()
}

/** Removes the topic along with everything scoped to it. Leaving the goals
 *  behind would strand them: they filter out of the personal list by having a
 *  topicId, and out of the topic list by having no topic. */
export async function deleteTopic(id: string) {
  await db.transaction('rw', [db.topics, db.goals, db.recurrences], async () => {
    await db.topics.update(id, touch({ deleted: 1 }))
    const goals = await db.goals.toArray()
    await Promise.all(
      goals.filter((g) => g.topicId === id && !g.deleted).map((g) => db.goals.update(g.id, touch({ deleted: 1 }))),
    )
    const recs = await db.recurrences.toArray()
    await Promise.all(
      recs
        .filter((r) => r.topicId === id && !r.deleted)
        .map((r) => db.recurrences.update(r.id, touch({ deleted: 1 }))),
    )
  })
  requestSync()
}

export async function reorderTopics(from: number, to: number) {
  const list = live(await db.topics.toArray()).sort(byOrder)
  await applyReorder(db.topics, list, from, to)
  requestSync()
}

export function useRecurrences(kind?: 'task' | 'goal'): Recurrence[] {
  return (
    useLiveQuery(
      async () => {
        const all = live(await db.recurrences.toArray())
        return (kind ? all.filter((r) => r.kind === kind) : all).sort((a, b) =>
          a.title.localeCompare(b.title),
        )
      },
      [kind],
      [],
    ) ?? []
  )
}

/* --- materialisation ------------------------------------------------------ */

/** Creates whatever instances the given date needs, and nothing else.
 *
 *  Safe to call repeatedly: an instance is skipped when a row with its id
 *  already exists, including a tombstoned one — so a deleted occurrence stays
 *  deleted rather than reappearing on the next render. */
export async function materialiseFor(date: ISODate): Promise<void> {
  const recurrences = live(await db.recurrences.toArray())
  if (recurrences.length === 0) return

  for (const rec of recurrences) {
    if (rec.kind === 'task') {
      if (!taskAppliesOn(rec, date)) continue
      const id = instanceId(rec.id, date)
      if (await db.tasks.get(id)) continue
      // Slot generated instances by their time like any other task, rather than
      // pinning them to the top of the day.
      const siblings = live(await db.tasks.where('date').equals(date).toArray())
        .filter((t) => !t.parentId)
        .sort(byOrder)
      const at = chronologicalIndex(siblings, rec.time)
      await db.tasks.add({
        id,
        date,
        title: rec.title,
        time: rec.time,
        tag: rec.tag,
        done: false,
        order: orderBetween(siblings[at - 1]?.order, siblings[at]?.order),
        recurrenceId: rec.id,
        deleted: 0,
        ...touch({}),
      })
    } else {
      const start = periodStart(rec.rule, date)
      if (start < periodStart(rec.rule, rec.startDate)) continue
      const id = instanceId(rec.id, periodKey(rec.rule, date))
      if (await db.goals.get(id)) continue
      const horizon = HORIZON_FOR_RULE[rec.rule] ?? 'month'
      const label = periodLabel(rec.rule, date)
      const siblings = live(await db.goals.toArray()).filter(
        (g) => g.horizon === horizon && g.label === label && g.topicId === rec.topicId,
      )
      await db.goals.add({
        id,
        horizon,
        label,
        title: rec.title,
        current: 0,
        target: rec.target,
        unit: rec.unit,
        topicId: rec.topicId,
        order: orderAtEnd(siblings.map((g) => g.order)),
        recurrenceId: rec.id,
        deleted: 0,
        ...touch({}),
      })
    }
  }
  requestSync()
}

/** Tasks captured through the iOS Shortcut arrive as raw text tagged 'inbox',
 *  because the SQL function cannot run the TypeScript parser. Re-parse them
 *  here so "read Dune 4pm" ends up with a real time, then clear the tag. */
export async function normaliseCaptured(date: ISODate): Promise<void> {
  const rows = live(await db.tasks.where('date').equals(date).toArray()).filter(
    (t) => t.tag === 'inbox',
  )
  if (rows.length === 0) return

  for (const t of rows) {
    const parsed = parseTaskInput(t.title, t.date)
    await db.tasks.update(t.id, touch({ title: parsed.title, time: parsed.time, tag: '' }))
    // A day word means it belongs on another date entirely.
    if (parsed.date !== t.date) await db.tasks.update(t.id, touch({ date: parsed.date }))
  }
  requestSync()
}

/** Carries unfinished tasks forward to today.
 *
 *  Recurring instances are skipped deliberately: "gym every day" regenerates on
 *  its own, so rolling yesterday's copy forward would collide with today's.
 *  Sub-tasks travel with their parent so a checklist is never split across days.
 *  `overdueFrom` keeps the earliest missed date, which is what turns the row
 *  red — completing the task clears it. */
export async function rolloverTasks(today: ISODate): Promise<void> {
  const stale = live(await db.tasks.where('date').below(today).toArray()).filter(
    (t) => !t.done && !t.recurrenceId && !t.parentId,
  )
  if (stale.length === 0) return

  const all = live(await db.tasks.toArray())
  for (const t of stale) {
    const from = t.overdueFrom ?? t.date
    await db.tasks.update(t.id, touch({ date: today, overdueFrom: from }))
    for (const child of all.filter((c) => c.parentId === t.id)) {
      await db.tasks.update(child.id, touch({ date: today }))
    }
  }
  requestSync()
}

/** Carries unfinished goals into the current period, progress intact.
 *
 *  Unlike tasks these are not flagged — a quarter goal spilling into the next
 *  quarter is normal, not a failure. Recurring goals are skipped because they
 *  mint a fresh instance each period by design. */
export async function rolloverGoals(labels: Record<Horizon, string>): Promise<void> {
  const goals = live(await db.goals.toArray())
  const stale = goals.filter(
    (g) => !g.recurrenceId && g.current < g.target && g.label !== labels[g.horizon],
  )
  if (stale.length === 0) return

  for (const g of stale) {
    // Don't resurrect a goal into a period that already holds the same title.
    // Scoped by topic, so an identically-named goal under a different topic
    // doesn't block the move.
    const clash = goals.some(
      (o) =>
        o.id !== g.id &&
        o.horizon === g.horizon &&
        o.title === g.title &&
        o.topicId === g.topicId &&
        o.label === labels[g.horizon],
    )
    if (clash) continue
    await db.goals.update(g.id, touch({ label: labels[g.horizon] }))
  }
  requestSync()
}

/** Runs materialisation, capture normalisation and rollover for the viewed
 *  date. Rollover always targets the real today, never the date being browsed. */
export function useMaterialise(date: ISODate): void {
  const recurrences = useRecurrences()
  useEffect(() => {
    void (async () => {
      await rolloverTasks(realToday())
      await materialiseFor(date)
      await normaliseCaptured(date)
    })()
    // `recurrences.length` re-runs this when a template is added or removed.
  }, [date, recurrences.length])
}

export async function addRecurrence(rec: Omit<Recurrence, keyof Synced>): Promise<void> {
  await db.recurrences.add({ id: newId(), deleted: 0, ...rec, ...touch({}) })
  requestSync()
}

/** Removes the template. Instances already created are left alone — past days
 *  keep their history; delete an individual occurrence to clear it. */
export async function deleteRecurrence(id: string): Promise<void> {
  await db.recurrences.update(id, touch({ deleted: 1 }))
  requestSync()
}

/* --- mutations ------------------------------------------------------------ */
/* Every mutation stamps `updatedAt`/`dirty` and nudges the sync engine. The
   nudge is debounced downstream, so calling it per keystroke is fine. */

export async function toggleTask(t: Task) {
  // Completing clears the overdue mark — a finished task is not still late.
  await db.tasks.update(t.id, touch({ done: !t.done, overdueFrom: t.done ? t.overdueFrom : undefined }))
  requestSync()
}

export async function addTask(
  date: ISODate,
  title: string,
  time = '',
  tag = '',
  parentId?: string,
) {
  const siblings = live(await db.tasks.where('date').equals(date).toArray())
    .filter((t) => t.parentId === parentId)
    .sort(byOrder)

  // Slot a timed task where the clock says it belongs; everything else appends.
  const index = chronologicalIndex(siblings, time)
  const order = orderBetween(siblings[index - 1]?.order, siblings[index]?.order)

  await db.tasks.add({
    id: newId(),
    date,
    title,
    time,
    tag,
    done: false,
    order,
    parentId,
    deleted: 0,
    ...touch({}),
  })
  requestSync()
}

/** Moves the task at `from` to `to` within its day. Writes one row unless the
 *  order values have crowded together, in which case the list is renumbered. */
export async function reorderTasks(date: ISODate, from: number, to: number) {
  const list = live(await db.tasks.where('date').equals(date).toArray())
    .filter((t) => !t.parentId)
    .sort(byOrder)
  await applyReorder(db.tasks, list, from, to)
  requestSync()
}

export async function reorderSubtasks(date: ISODate, parentId: string, from: number, to: number) {
  const list = live(await db.tasks.where('date').equals(date).toArray())
    .filter((t) => t.parentId === parentId)
    .sort(byOrder)
  await applyReorder(db.tasks, list, from, to)
  requestSync()
}

export async function reorderGoals(
  horizon: Horizon,
  label: string,
  from: number,
  to: number,
  topicId?: string,
) {
  const list = live(await db.goals.toArray())
    .filter((g) => g.horizon === horizon && g.label === label && g.topicId === topicId)
    .sort(byOrder)
  await applyReorder(db.goals, list, from, to)
  requestSync()
}

/** Shared move logic for any ordered, synced table. */
async function applyReorder<T extends { id: string; order: number }>(
  table: { update: (id: string, patch: object) => Promise<unknown> },
  list: T[],
  from: number,
  to: number,
): Promise<void> {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return

  const moved = list[from]
  const without = list.filter((_, i) => i !== from)
  const order = orderBetween(without[to - 1]?.order, without[to]?.order)

  await table.update(moved.id, touch({ order }))

  // Renumber only when midpoints have run out of room.
  const next = without.map((x) => x.order).concat(order)
  if (needsRebalance(next)) {
    const resorted = [...without]
    resorted.splice(to, 0, { ...moved, order })
    for (const { item, order: o } of rebalanced(resorted)) {
      await table.update(item.id, touch({ order: o }))
    }
  }
}

/** Tombstones the task and, for a parent, its sub-tasks — an orphaned child
 *  would otherwise be invisible but still counted. */
export async function deleteTask(id: string) {
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.update(id, touch({ deleted: 1 }))
    const children = await db.tasks.toArray()
    await Promise.all(
      children
        .filter((c) => c.parentId === id && !c.deleted)
        .map((c) => db.tasks.update(c.id, touch({ deleted: 1 }))),
    )
  })
  requestSync()
}

export async function updateTask(id: string, patch: Partial<Task>) {
  await db.tasks.update(id, touch(patch))
  requestSync()
}

export async function toggleHabit(date: ISODate, habitId: string, current: boolean) {
  const id = habitLogId(date, habitId)
  const existing = await db.habitLogs.get(id)
  if (existing) await db.habitLogs.update(id, touch({ done: !current, deleted: 0 }))
  else await db.habitLogs.add({ id, date, habitId, done: !current, deleted: 0, ...touch({}) })
  requestSync()
}

export async function addHabit(name: string) {
  const existing = await db.habits.toArray()
  await db.habits.add({
    id: newId(),
    name,
    short: name.slice(0, 5).toUpperCase(),
    order: existing.filter((h) => !h.deleted).length,
    deleted: 0,
    ...touch({}),
  })
  requestSync()
}

export async function deleteHabit(id: string) {
  await db.transaction('rw', [db.habits, db.habitLogs], async () => {
    await db.habits.update(id, touch({ deleted: 1 }))
    const logs = await db.habitLogs.where('habitId').equals(id).toArray()
    await Promise.all(logs.map((l) => db.habitLogs.update(l.id, touch({ deleted: 1 }))))
  })
  requestSync()
}

export async function setMetric(
  date: ISODate,
  patch: Partial<Pick<DailyMetric, 'weight' | 'hours' | 'screen'>>,
) {
  const existing = await db.metrics.get(date)
  await db.metrics.put({
    id: date,
    date,
    ...existing,
    ...patch,
    deleted: 0,
    ...touch({}),
  })
  requestSync()
}

export async function setJournal(date: ISODate, best: string) {
  await db.journal.put({ id: date, date, best, deleted: 0, ...touch({}) })
  requestSync()
}

export async function setGoalProgress(id: string, current: number) {
  await db.goals.update(id, touch({ current }))
  requestSync()
}

export async function updateGoal(id: string, patch: Partial<Goal>) {
  await db.goals.update(id, touch(patch))
  requestSync()
}

export async function addGoal(
  horizon: Horizon,
  label: string,
  title: string,
  target: number,
  unit: string,
  topicId?: string,
) {
  const existing = live(await db.goals.where('horizon').equals(horizon).toArray()).filter(
    (g) => g.label === label && g.topicId === topicId,
  )
  await db.goals.add({
    id: newId(),
    horizon,
    label,
    title,
    current: 0,
    target,
    unit,
    topicId,
    order: orderAtEnd(existing.map((g) => g.order)),
    deleted: 0,
    ...touch({}),
  })
  requestSync()
}

export async function deleteGoal(id: string) {
  await db.goals.update(id, touch({ deleted: 1 }))
  requestSync()
}
