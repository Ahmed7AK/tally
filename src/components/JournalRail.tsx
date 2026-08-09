import { useEffect, useState } from 'react'
import { setGoalProgress, setJournal, useDaySummary, useGoals, useJournal, useMetric } from '../db/hooks'
import type { ISODate } from '../lib/date'
import { playDing } from '../lib/sound'
import { Check, Label, Ring } from '../components/ui'

/** Today's tally: the three logged numbers followed by one card per habit. */
export function TallyGrid({ date }: { date: ISODate }) {
  const { habits, logs } = useDaySummary(date)
  const m = useMetric(date)
  const nums: [string, number | undefined][] = [
    ['Weight', m?.weight],
    ['Hours', m?.hours],
    ['Screen', m?.screen],
  ]
  return (
    <div className="tally">
      {nums.map(([name, v]) => (
        <div className="tally-card" key={name} data-off={v == null}>
          <span className="tally-val">{v ?? '—'}</span>
          <span className="tally-name">{name}</span>
        </div>
      ))}
      {habits.map((h) => {
        const on = !!logs[h.id]
        return (
          <div className="tally-card" key={h.id} data-on={on} data-off={!on}>
            <span className="tally-val">{on ? '✓' : '—'}</span>
            <span className="tally-name">{h.name}</span>
          </div>
        )
      })}
    </div>
  )
}

export function WeekChecks() {
  const goals = useGoals()
  const week = goals.filter((g) => g.horizon === 'week')
  if (week.length === 0) return null
  return (
    <div className="section">
      <Label>This week</Label>
      <div className="rows">
        {week.map((g) => {
          const done = g.current >= g.target
          return (
            <div className="row" key={g.id}>
              <button
                onClick={() => {
                  if (!done) playDing()
                  void setGoalProgress(g.id, done ? 0 : g.target)
                }}
                aria-pressed={done}
                aria-label={g.title}
              >
                <Check on={done} />
              </button>
              <span className={done ? 'row-title strike' : 'row-title'} style={{ flex: 1 }}>
                {g.title}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function BestPart({ date }: { date: ISODate }) {
  const entry = useJournal(date)
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)

  // Adopt the stored value whenever the day changes or a fresh read lands,
  // but never clobber what the user is actively typing.
  useEffect(() => {
    if (!dirty) setText(entry?.best ?? '')
  }, [entry?.best, date, dirty])

  useEffect(() => {
    setDirty(false)
  }, [date])

  return (
    <div className="note">
      <Label accent>Best part of today</Label>
      <textarea
        value={text}
        rows={3}
        placeholder="Tap to write…"
        aria-label="Best part of today"
        onChange={(e) => {
          setDirty(true)
          setText(e.target.value)
        }}
        onBlur={() => {
          setJournal(date, text)
          setDirty(false)
        }}
      />
    </div>
  )
}

export default function JournalRail({ date }: { date: ISODate }) {
  const { rating, tasksDone, tasksTotal, habitsDone, habitsTotal } = useDaySummary(date)
  return (
    <>
      <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Label>Day rating</Label>
          <span style={{ fontSize: 13.5, color: 'var(--dim)' }}>
            {tasksDone}/{tasksTotal} tasks · {habitsDone}/{habitsTotal} habits
          </span>
        </div>
        <Ring value={rating} size={62} stroke={6} />
      </div>

      <div className="section">
        <Label>Today's tally</Label>
        <TallyGrid date={date} />
      </div>

      <WeekChecks />

      <div className="spacer" />
      <BestPart date={date} />
    </>
  )
}
