import { useState } from 'react'
import { addHabit, deleteHabit, toggleHabit, useHabits, useMonthHabitLogs, useMonthMetrics } from '../db/hooks'
import { fromISO, monthDates, today as todayISO, type ISODate } from '../lib/date'
import { playDing } from '../lib/sound'
import { Empty, Label } from '../components/ui'

/** The 31-day grid: three metric columns (weight / hours / screen) followed by
 *  one tick column per habit, exactly as the design lays it out. */
export default function Habits({ date }: { date: ISODate }) {
  const habits = useHabits()
  const logs = useMonthHabitLogs(date)
  const metrics = useMonthMetrics(date)
  const days = monthDates(date)
  const t0 = todayISO()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const metricByDate = Object.fromEntries(metrics.map((m) => [m.date, m]))
  const cols = ['WT', 'HRS', 'SCR', ...habits.map((h) => h.short)]
  const template = `34px repeat(${cols.length}, 1fr)`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = draft.trim()
    if (!name) return
    await addHabit(name)
    setDraft('')
    setAdding(false)
  }

  return (
    <>
      {habits.length === 0 ? (
        <div className="card">
          <Empty>
            No habits yet. Add one below and it'll appear here as a column you can tick off each
            day.
          </Empty>
        </div>
      ) : (
      <div className="hgrid-wrap">
        <div className="hgrid-head" style={{ gridTemplateColumns: template }}>
          <div />
          {cols.map((c, i) => (
            <div className="hgrid-col" key={`${c}-${i}`}>
              {c}
            </div>
          ))}
        </div>
        <div className="hgrid-body">
          {days.map((d) => {
            const m = metricByDate[d] ?? {}
            const dayLogs = logs[d] ?? {}
            return (
              <div
                className="hgrid-row"
                key={d}
                data-today={d === t0}
                style={{ gridTemplateColumns: template }}
              >
                <div className="hgrid-day">{String(fromISO(d).getDate()).padStart(2, '0')}</div>
                <div className="hgrid-cell" data-num={m.weight != null}>
                  {m.weight ?? '—'}
                </div>
                <div className="hgrid-cell" data-num={m.hours != null}>
                  {m.hours ?? '—'}
                </div>
                <div className="hgrid-cell" data-num={m.screen != null}>
                  {m.screen ?? '—'}
                </div>
                {habits.map((h) => {
                  const on = !!dayLogs[h.id]
                  return (
                    <button
                      key={h.id}
                      className="hgrid-cell"
                      data-on={on}
                      data-clickable="true"
                      onClick={() => {
                        if (!on) playDing()
                        void toggleHabit(d, h.id, on)
                      }}
                      aria-label={`${h.name} on ${d}`}
                      aria-pressed={on}
                    >
                      {on ? '×' : ''}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      )}

      <div className="section">
        <Label>Habits tracked</Label>
        <div className="rows">
          {habits.map((h) => (
            <div className="row" key={h.id}>
              <div className="row-body">
                <span className="row-title">{h.name}</span>
                <span className="row-tag">{h.short}</span>
              </div>
              <button className="row-del" onClick={() => deleteHabit(h.id)} aria-label={`Delete ${h.name}`}>
                ×
              </button>
            </div>
          ))}
        </div>
        {adding ? (
          <form className="row-add" onSubmit={submit}>
            <span className="row-add-glyph">＋</span>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => !draft && setAdding(false)}
              placeholder="Habit name"
              aria-label="New habit name"
            />
          </form>
        ) : (
          <button className="ghost-btn" onClick={() => setAdding(true)}>
            ＋ New habit
          </button>
        )}
      </div>
    </>
  )
}
