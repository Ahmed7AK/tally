/** Local-time date helpers. Everything in the app keys off `YYYY-MM-DD` strings
 *  computed in the user's own timezone — never UTC, or the day flips at the
 *  wrong hour. */

export type ISODate = string

export function toISO(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): ISODate {
  return toISO(new Date())
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** Monday-first weekday index (0 = Mon … 6 = Sun). */
export function weekdayIndex(s: ISODate): number {
  return (fromISO(s).getDay() + 6) % 7
}

/** The Monday of the week containing `s`. */
export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, -weekdayIndex(s))
}

export function weekDates(s: ISODate): ISODate[] {
  const mon = startOfWeek(s)
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}

export function startOfMonth(s: ISODate): ISODate {
  const d = fromISO(s)
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function daysInMonth(s: ISODate): number {
  const d = fromISO(s)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

export function monthDates(s: ISODate): ISODate[] {
  const first = startOfMonth(s)
  return Array.from({ length: daysInMonth(s) }, (_, i) => addDays(first, i))
}

/** The 35 cells of a Monday-first month grid, `null` outside the month. */
export function monthGrid(s: ISODate): (ISODate | null)[] {
  const first = startOfMonth(s)
  const lead = weekdayIndex(first)
  const n = daysInMonth(s)
  const cells: (ISODate | null)[] = []
  for (let i = 0; i < 42; i++) {
    const dayNum = i - lead
    cells.push(dayNum >= 0 && dayNum < n ? addDays(first, dayNum) : null)
  }
  // Trim a trailing all-empty week so short months don't render a blank row.
  while (cells.length > 35 && cells.slice(-7).every((c) => c === null)) cells.length -= 7
  return cells
}

export function addMonths(s: ISODate, n: number): ISODate {
  const d = fromISO(s)
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

export const DOW_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
export const DOW_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function monthName(s: ISODate): string {
  return MONTHS[fromISO(s).getMonth()]
}

export function fmtLong(s: ISODate): string {
  const d = fromISO(s)
  const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]
  return `${dow} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function fmtLongYear(s: ISODate): string {
  return `${fmtLong(s)} ${fromISO(s).getFullYear()}`
}

export function fmtRange(a: ISODate, b: ISODate): string {
  const da = fromISO(a)
  const db = fromISO(b)
  const mb = MONTHS[db.getMonth()].slice(0, 3)
  return `${da.getDate()} — ${db.getDate()} ${mb}`
}

export function quarterOf(s: ISODate): string {
  const d = fromISO(s)
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
}
