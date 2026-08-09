import type { Horizon, RepeatRule, Recurrence } from '../db/db'
import { fromISO, monthName, quarterOf, startOfMonth, startOfWeek, addDays, fmtRange, type ISODate } from './date'

/* ---------------------------------------------------------------------------
   Recurrence rules.

   A recurrence is a template, not a schedule. Nothing is generated in advance:
   opening a date asks "which templates apply here, and does an instance exist
   yet?". Instance ids are `<recurrenceId>:<periodKey>`, which makes the whole
   thing idempotent — two devices materialising the same day converge on one
   row, and deleting an instance keeps it deleted because the id is taken.
   --------------------------------------------------------------------------- */

export const TASK_RULES: RepeatRule[] = ['daily', 'weekdays', 'weekly']
export const GOAL_RULES: RepeatRule[] = ['weekly', 'monthly', 'quarterly']

export const RULE_LABEL: Record<RepeatRule, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every quarter',
}

/** Does a task recurrence produce an instance on this date? */
export function taskAppliesOn(rec: Recurrence, date: ISODate): boolean {
  if (date < rec.startDate) return false
  const dow = fromISO(date).getDay()
  switch (rec.rule) {
    case 'daily':
      return true
    case 'weekdays':
      return dow >= 1 && dow <= 5
    case 'weekly':
      return dow === rec.weekday
    default:
      return false
  }
}

/** The period a date belongs to, as a stable key used in instance ids. */
export function periodKey(rule: RepeatRule, date: ISODate): string {
  const d = fromISO(date)
  switch (rule) {
    case 'monthly':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    case 'quarterly':
      return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
    case 'weekly':
      return startOfWeek(date)
    default:
      return date
  }
}

/** Human label for the period a recurring goal instance covers — the same
 *  wording the non-recurring goals already use. */
export function periodLabel(rule: RepeatRule, date: ISODate): string {
  switch (rule) {
    case 'monthly':
      return monthName(date)
    case 'quarterly':
      return quarterOf(date)
    case 'weekly': {
      const start = startOfWeek(date)
      return fmtRange(start, addDays(start, 6))
    }
    default:
      return date
  }
}

/** The first date of the period containing `date` — where a materialised goal
 *  anchors, so the whole period shares one instance. */
export function periodStart(rule: RepeatRule, date: ISODate): ISODate {
  switch (rule) {
    case 'monthly':
      return startOfMonth(date)
    case 'quarterly': {
      const d = fromISO(date)
      const firstMonth = Math.floor(d.getMonth() / 3) * 3
      return `${d.getFullYear()}-${String(firstMonth + 1).padStart(2, '0')}-01`
    }
    case 'weekly':
      return startOfWeek(date)
    default:
      return date
  }
}

export const HORIZON_FOR_RULE: Record<string, Horizon> = {
  weekly: 'week',
  monthly: 'month',
  quarterly: 'quarter',
}

export function instanceId(recurrenceId: string, key: string): string {
  return `${recurrenceId}:${key}`
}
