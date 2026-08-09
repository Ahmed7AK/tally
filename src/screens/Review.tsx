import {
  useHabits,
  useMonthHabitLogs,
  useMonthJournal,
  useMonthMetrics,
  useRatingSeries,
} from '../db/hooks'
import { fromISO, monthDates, type ISODate } from '../lib/date'
import { Empty, Label } from '../components/ui'

export default function Review({ date }: { date: ISODate }) {
  const days = monthDates(date)
  const metrics = useMonthMetrics(date)
  const habits = useHabits()
  const logs = useMonthHabitLogs(date)
  const moments = useMonthJournal(date)
  const ratings = useRatingSeries(days[days.length - 1], days.length)

  const rated = ratings.map((r) => r.rating).filter((r): r is number => r != null)
  const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null

  const weights = metrics.map((m) => m.weight).filter((w): w is number => w != null)
  const delta = weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null

  // "Gym days" reads the first habit whose name mentions the gym; falls back to
  // the busiest habit so the tile is never meaningless.
  const gym = habits.find((h) => /gym/i.test(h.name)) ?? habits[0]
  const gymDays = gym ? Object.values(logs).filter((d) => d[gym.id]).length : 0

  return (
    <>
      <div className="stat3">
        <div className="stat">
          <span className="stat-val" data-accent="true">
            {avg?.toFixed(1) ?? '—'}
          </span>
          <span className="stat-name">Avg day</span>
        </div>
        <div className="stat">
          <span className="stat-val">
            {delta == null ? '—' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`}
          </span>
          <span className="stat-name">kg</span>
        </div>
        <div className="stat">
          <span className="stat-val">{gymDays}</span>
          <span className="stat-name">{gym ? `${gym.short} days` : 'Days'}</span>
        </div>
      </div>

      <div className="section">
        <Label>Memorable moments</Label>
        <div className="card" style={{ padding: '14px 16px 2px' }}>
          {moments.length === 0 && <Empty>Nothing written this month yet.</Empty>}
          {moments.map((m) => (
            <div className="moment" key={m.date}>
              <span className="moment-n">{String(fromISO(m.date).getDate()).padStart(2, '0')}</span>
              <span className="moment-t">{m.best}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
