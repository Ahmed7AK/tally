import { useEffect, useState } from 'react'
import {
  setGoalProgress,
  setJournal,
  setMetric,
  useDaySummary,
  useGoals,
  useJournal,
  useMetric,
} from '../db/hooks'
import type { ISODate } from '../lib/date'
import { playDing } from '../lib/sound'
import { Check, Label, Ring } from '../components/ui'

/** One editable metric card. Commits on blur rather than per keystroke, so a
 *  three-digit weight is one sync round trip instead of three. */
function MetricCard({
  name,
  value,
  step,
  onCommit,
}: {
  name: string
  value: number | undefined
  step: number
  onCommit: (n: number | undefined) => void
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  // Adopt the stored value unless the user is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value))
  }, [value, editing])

  function commit() {
    setEditing(false)
    const text = draft.trim()
    if (text === '') return onCommit(undefined)
    const n = Number(text)
    if (!Number.isNaN(n)) onCommit(n)
  }

  return (
    <div className="tally-card" data-off={value == null}>
      <input
        className="tally-input"
        type="number"
        inputMode="decimal"
        step={step}
        value={draft}
        placeholder="—"
        aria-label={`${name} for this day`}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setEditing(false)
            setDraft(value == null ? '' : String(value))
            e.currentTarget.blur()
          }
        }}
      />
      <span className="tally-name">{name}</span>
    </div>
  )
}

/** Today's tally: three editable numbers followed by one card per habit. */
export function TallyGrid({ date }: { date: ISODate }) {
  const { habits, logs } = useDaySummary(date)
  const m = useMetric(date)
  const nums: [string, number | undefined, number, 'weight' | 'hours' | 'screen'][] = [
    ['Weight', m?.weight, 0.1, 'weight'],
    ['Hours', m?.hours, 0.5, 'hours'],
    ['Screen', m?.screen, 0.1, 'screen'],
  ]
  return (
    <div className="tally">
      {nums.map(([name, v, step, key]) => (
        <MetricCard
          key={name}
          name={name}
          value={v}
          step={step}
          onCommit={(n) => setMetric(date, { [key]: n })}
        />
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
