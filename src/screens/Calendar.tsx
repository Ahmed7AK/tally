import { useHabits, useMonthHabitLogs, useMonthJournal, useMonthTaskCounts } from '../db/hooks'
import { DOW_LETTER, fromISO, monthGrid, today as todayISO, type ISODate } from '../lib/date'

export default function Calendar({
  date,
  setDate,
}: {
  date: ISODate
  setDate: (d: ISODate) => void
}) {
  const cells = monthGrid(date)
  const counts = useMonthTaskCounts(date)
  const logs = useMonthHabitLogs(date)
  const habits = useHabits()
  const moments = useMonthJournal(date)
  const t0 = todayISO()

  const momentFor = Object.fromEntries(moments.map((m) => [m.date, m.best]))
  const selected = counts[date]
  const selectedHabits = Object.values(logs[date] ?? {}).filter(Boolean).length

  return (
    <>
      <div className="cal">
        {DOW_LETTER.map((l, i) => (
          <div className="cal-dow" key={i} style={i === (fromISO(t0).getDay() + 6) % 7 ? { color: 'var(--accent)' } : undefined}>
            {l}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div className="cal-cell" data-empty="true" key={`e${i}`} />
          const c = counts[d]
          const habitDone = Object.values(logs[d] ?? {}).filter(Boolean).length
          return (
            <button
              className="cal-cell"
              key={d}
              data-today={d === date}
              onClick={() => setDate(d)}
              aria-label={d}
              aria-current={d === t0 ? 'date' : undefined}
              style={d === t0 && d !== date ? { borderColor: 'var(--accent)' } : undefined}
            >
              <span className="cal-n">{fromISO(d).getDate()}</span>
              <span className="cal-dots">
                {c && c.done > 0 && <span style={{ background: 'var(--accent)' }} />}
                {habitDone > 0 && <span style={{ background: 'var(--dim)' }} />}
                {momentFor[d] && <span style={{ background: 'var(--fg-2)' }} />}
              </span>
            </button>
          )
        })}
      </div>

      <div className="note">
        <span className="label">
          {fromISO(date).getDate()} — {selected?.total ?? 0} tasks, {selectedHabits}/{habits.length} habits
        </span>
        <span style={{ fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.45 }}>
          {momentFor[date] || 'No reflection written for this day.'}
        </span>
      </div>
    </>
  )
}
