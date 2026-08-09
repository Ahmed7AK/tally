import { addDays, fromISO, type ISODate } from './date'

/* ---------------------------------------------------------------------------
   Natural-language capture, TickTick style: "read Dune 4pm" becomes the task
   "read Dune" at 16:00.

   The parser is deliberately conservative. It only claims tokens that are
   unambiguously a time or a day, because wrongly eating a word out of the title
   is far more annoying than failing to detect a time. Bare numbers are never
   times ("read 4 pages" keeps its 4), and the composer shows a live preview of
   whatever was matched so nothing is removed invisibly.
   --------------------------------------------------------------------------- */

export interface ParsedTask {
  title: string
  /** 24-hour "HH:MM", or '' when no time was found. */
  time: string
  date: ISODate
  /** True when a day word moved the task off the date being viewed. */
  dateMatched: boolean
  timeMatched: boolean
  /** Set when the text asked for a repeat ("every day", "every monday"). */
  repeat: RepeatRule | null
  /** Weekday for a weekly repeat, 0 = Sunday. */
  repeatWeekday: number
}

type RepeatRule = 'daily' | 'weekdays' | 'weekly'

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

const DAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** "sun" and "sat" are ordinary English words far more often than they are days,
 *  so they only count when a keyword like "on" or "next" precedes them. */
const RISKY_ABBR = new Set(['sun', 'sat'])

interface Match {
  start: number
  end: number
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Nearest date whose weekday is `target`, at or after `base`. */
function nextWeekday(base: ISODate, target: number): ISODate {
  const current = fromISO(base).getDay()
  const offset = (target - current + 7) % 7
  return addDays(base, offset)
}

function findTime(text: string): { time: string; match: Match } | null {
  // 12-hour with meridiem: 4pm, 4:30 pm, 12am. Optional leading "at"/"@".
  const meridiem = /(?:\b(?:at|@)\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text)
  if (meridiem) {
    let hour = Number(meridiem[1])
    const minute = Number(meridiem[2] ?? 0)
    if (hour >= 1 && hour <= 12 && minute < 60) {
      const isPM = meridiem[3].toLowerCase() === 'pm'
      if (hour === 12) hour = isPM ? 12 : 0
      else if (isPM) hour += 12
      return {
        time: `${pad(hour)}:${pad(minute)}`,
        match: { start: meridiem.index, end: meridiem.index + meridiem[0].length },
      }
    }
  }

  // 24-hour with an explicit colon: 16:00, 9:30. A bare number is never a time.
  const colon = /(?:\b(?:at|@)\s*)?\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (colon) {
    return {
      time: `${pad(Number(colon[1]))}:${colon[2]}`,
      match: { start: colon.index, end: colon.index + colon[0].length },
    }
  }

  return null
}

function findDay(text: string, base: ISODate): { date: ISODate; match: Match } | null {
  const relative = /\b(today|tonight|tomorrow|tmr|tmrw)\b/i.exec(text)
  if (relative) {
    const word = relative[1].toLowerCase()
    const date = word === 'today' || word === 'tonight' ? base : addDays(base, 1)
    return { date, match: { start: relative.index, end: relative.index + relative[0].length } }
  }

  // Full day names, optionally preceded by on/this/next.
  const full = new RegExp(`(?:\\b(on|this|next)\\s+)?\\b(${DAY_NAMES.join('|')})\\b`, 'i').exec(text)
  if (full) {
    const target = DAY_NAMES.indexOf(full[2].toLowerCase())
    let date = nextWeekday(base, target)
    if (full[1]?.toLowerCase() === 'next') date = addDays(date, 7)
    return { date, match: { start: full.index, end: full.index + full[0].length } }
  }

  // Abbreviations are riskier, so they need either a keyword in front or to be
  // the final token — and the two that double as common nouns need the keyword.
  const abbr = new RegExp(`(?:\\b(on|this|next)\\s+)?\\b(${DAY_ABBR.join('|')})\\b`, 'i').exec(text)
  if (abbr) {
    const word = abbr[2].toLowerCase()
    const keyword = abbr[1]?.toLowerCase()
    const isTrailing = abbr.index + abbr[0].length === text.trimEnd().length
    const allowed = keyword ? true : isTrailing && !RISKY_ABBR.has(word)
    if (allowed) {
      const target = DAY_ABBR.indexOf(word)
      let date = nextWeekday(base, target)
      if (keyword === 'next') date = addDays(date, 7)
      return { date, match: { start: abbr.index, end: abbr.index + abbr[0].length } }
    }
  }

  return null
}

/** Remove the matched ranges and tidy the leftover whitespace and connectors. */
function strip(text: string, matches: Match[]): string {
  let out = ''
  let cursor = 0
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, m.start)
    cursor = m.end
  }
  out += text.slice(cursor)
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\b(at|on|@)\s*$/i, '')
    .trim()
}

function findRepeat(
  text: string,
  base: ISODate,
): { rule: RepeatRule; weekday: number; match: Match } | null {
  // "every weekday" / "weekdays"
  const weekdays = /\bevery\s+weekdays?\b|\bweekdays\b|\bevery\s+work\s*day\b/i.exec(text)
  if (weekdays) {
    return {
      rule: 'weekdays',
      weekday: 1,
      match: { start: weekdays.index, end: weekdays.index + weekdays[0].length },
    }
  }

  // "every monday" / "every mon" — checked before the plain day parser, which
  // would otherwise claim the day name and turn a repeat into a one-off.
  const everyDay = new RegExp(
    `\\bevery\\s+(${DAY_NAMES.join('|')}|${DAY_ABBR.join('|')})s?\\b`,
    'i',
  ).exec(text)
  if (everyDay) {
    const word = everyDay[1].toLowerCase()
    const weekday = DAY_NAMES.indexOf(word) >= 0 ? DAY_NAMES.indexOf(word) : DAY_ABBR.indexOf(word)
    return {
      rule: 'weekly',
      weekday,
      match: { start: everyDay.index, end: everyDay.index + everyDay[0].length },
    }
  }

  // "every day" / "daily"
  const daily = /\bevery\s+day\b|\bdaily\b/i.exec(text)
  if (daily) {
    return { rule: 'daily', weekday: 1, match: { start: daily.index, end: daily.index + daily[0].length } }
  }

  // "every week" / "weekly" — anchored to the weekday being viewed.
  const weekly = /\bevery\s+week\b|\bweekly\b/i.exec(text)
  if (weekly) {
    return {
      rule: 'weekly',
      weekday: fromISO(base).getDay(),
      match: { start: weekly.index, end: weekly.index + weekly[0].length },
    }
  }

  return null
}

export function parseTaskInput(input: string, base: ISODate): ParsedTask {
  const text = input.trim()

  // Repeat is resolved first and removed, so the day parser never sees the
  // "monday" inside "every monday".
  const repeat = findRepeat(text, base)
  const rest = repeat ? strip(text, [repeat.match]) : text

  const time = findTime(rest)
  // A repeating task has no single date — its instances are generated per day.
  const day = repeat ? null : findDay(rest, base)

  const matches: Match[] = []
  if (time) matches.push(time.match)
  if (day) matches.push(day.match)
  const title = strip(rest, matches)

  return {
    // Falling back to the raw text means input that is *only* a time — "4pm" —
    // still produces a usable task rather than an empty one.
    title: title || rest || text,
    time: time?.time ?? '',
    date: day?.date ?? base,
    dateMatched: Boolean(day) && title.length > 0,
    timeMatched: Boolean(time) && title.length > 0,
    repeat: repeat?.rule ?? null,
    repeatWeekday: repeat?.weekday ?? 1,
  }
}

/** "16:00" -> "4:00 PM", for display. */
export function formatTime(time: string): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${pad(m)} ${suffix}`
}
