import { useEffect, useState } from 'react'
import {
  addGoal,
  addRecurrence,
  deleteGoal,
  deleteRecurrence,
  rolloverGoals,
  setGoalProgress,
  updateGoal,
  useGoals,
  useMaterialise,
  useRecurrences,
} from '../db/hooks'
import { addDays, fmtRange, monthName, quarterOf, startOfWeek, type ISODate } from '../lib/date'
import { GOAL_RULES, HORIZON_FOR_RULE, RULE_LABEL } from '../lib/recur'
import { playDing } from '../lib/sound'
import { Bar, Check, Label } from '../components/ui'
import type { Goal, Horizon, RepeatRule } from '../db/db'

const HORIZONS: Horizon[] = ['quarter', 'month', 'week']

const RULE_FOR_HORIZON: Record<Horizon, RepeatRule> = {
  quarter: 'quarterly',
  month: 'monthly',
  week: 'weekly',
}

/** Inline editor. Goals were previously write-once, so a slip in the unit field
 *  (the stray "1" in "0 / 3 1") could only be fixed by deleting and retyping. */
function GoalEditor({ g, onDone }: { g: Goal; onDone: () => void }) {
  const [title, setTitle] = useState(g.title)
  const [target, setTarget] = useState(String(g.target))
  const [unit, setUnit] = useState(g.unit)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await updateGoal(g.id, {
      title: title.trim(),
      target: Number(target) || 1,
      unit: unit.trim(),
    })
    onDone()
  }

  return (
    <form className="goal-item goal-edit" onSubmit={save}>
      <label className="field">
        <span className="field-label">Goal</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Target</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span className="field-label">Unit — optional</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="km, hrs…" />
        </label>
      </div>
      <div className="field-actions">
        <button type="submit" className="btn-primary">
          Save
        </button>
        <button type="button" className="ghost-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function GoalRow({ g }: { g: Goal }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <GoalEditor g={g} onDone={() => setEditing(false)} />

  const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0
  const step = g.target > 20 ? Math.max(1, Math.round(g.target / 20)) : 1
  const repeating = Boolean(g.recurrenceId)

  // A single-target goal with no unit reads as a checkbox rather than a bar.
  if (g.target === 1 && !g.unit) {
    const done = g.current >= 1
    return (
      <div className="row">
        <button
          onClick={() => {
            if (!done) playDing()
            void setGoalProgress(g.id, done ? 0 : 1)
          }}
          aria-pressed={done}
        >
          <Check on={done} />
        </button>
        <span className={done ? 'row-title strike' : 'row-title'} style={{ flex: 1 }}>
          {g.title}
          {repeating && <span className="repeat-badge" title="Repeating">↻</span>}
        </span>
        <button className="row-del" onClick={() => setEditing(true)} aria-label={`Edit ${g.title}`}>
          ✎
        </button>
        <button className="row-del" onClick={() => deleteGoal(g.id)} aria-label={`Delete ${g.title}`}>
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="goal-item">
      <div className="goal-top">
        <span className="goal-title">
          {g.title}
          {repeating && <span className="repeat-badge" title="Repeating">↻</span>}
        </span>
        <span className="goal-pct">{pct}%</span>
      </div>
      <Bar pct={pct} />
      <div className="goal-top">
        <span className="goal-sub">
          {g.current} / {g.target}
          {g.unit ? ` ${g.unit}` : ''}
        </span>
        <div className="goal-step">
          <button
            onClick={() => setGoalProgress(g.id, Math.max(0, g.current - step))}
            aria-label={`Decrease ${g.title}`}
          >
            −
          </button>
          <button
            onClick={() => {
              const next = Math.min(g.target, g.current + step)
              if (next >= g.target && g.current < g.target) playDing()
              void setGoalProgress(g.id, next)
            }}
            aria-label={`Increase ${g.title}`}
          >
            ＋
          </button>
          <button className="row-del" onClick={() => setEditing(true)} aria-label={`Edit ${g.title}`}>
            ✎
          </button>
          <button className="row-del" onClick={() => deleteGoal(g.id)} aria-label={`Delete ${g.title}`}>
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

function AddGoalForm({
  horizon,
  label,
  onDone,
}: {
  horizon: Horizon
  label: string
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [repeat, setRepeat] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const numericTarget = Number(target) || 1

    if (repeat) {
      // The template regenerates each period; materialisation creates the
      // instance for the current one immediately.
      await addRecurrence({
        kind: 'goal',
        rule: RULE_FOR_HORIZON[horizon],
        title: title.trim(),
        time: '',
        tag: '',
        horizon,
        target: numericTarget,
        unit: unit.trim(),
        startDate: new Date().toISOString().slice(0, 10),
        weekday: 1,
      })
    } else {
      await addGoal(horizon, label, title.trim(), numericTarget, unit.trim())
    }
    onDone()
  }

  return (
    <form className="goal-item goal-edit" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Goal</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Run 170km" />
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Target</span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            placeholder="170"
          />
        </label>
        <label className="field">
          <span className="field-label">Unit — optional</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="km, hrs…" />
        </label>
      </div>
      <label className="field-check">
        <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
        <span>Repeat every {horizon} — starts fresh each period</span>
      </label>
      <div className="field-actions">
        <button type="submit" className="btn-primary">
          Add goal
        </button>
        <button type="button" className="ghost-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function Goals({ date }: { date: ISODate }) {
  useMaterialise(date)
  const goals = useGoals()
  const recurrences = useRecurrences('goal')
  const [adding, setAdding] = useState<Horizon | null>(null)

  const weekStart = startOfWeek(date)
  const labelFor: Record<Horizon, string> = {
    quarter: quarterOf(date),
    month: monthName(date),
    week: fmtRange(weekStart, addDays(weekStart, 6)),
  }

  // Unfinished goals follow you into the new period, progress intact and
  // without an overdue flag — a quarter goal spilling over is normal.
  useEffect(() => {
    void rolloverGoals(labelFor)
  }, [labelFor.quarter, labelFor.month, labelFor.week])

  return (
    <>
      {HORIZONS.map((h) => {
        const items = goals.filter((g) => g.horizon === h && g.label === labelFor[h])
        return (
          <div className="goal-group" key={h}>
            <div className="goal-group-head">
              <Label accent>{h}</Label>
              <span className="goal-sub">{labelFor[h]}</span>
            </div>
            <div className="rows">
              {items.length === 0 && adding !== h && (
                <div className="empty">Nothing set for this {h} yet.</div>
              )}
              {items.map((g) => (
                <GoalRow g={g} key={g.id} />
              ))}
              {adding === h && (
                <AddGoalForm horizon={h} label={labelFor[h]} onDone={() => setAdding(null)} />
              )}
            </div>
            {adding !== h && (
              <button className="ghost-btn" onClick={() => setAdding(h)}>
                ＋ New {h} goal
              </button>
            )}
          </div>
        )
      })}

      {recurrences.length > 0 && (
        <div className="section">
          <Label>Repeating goals</Label>
          <div className="rows">
            {recurrences.map((r) => (
              <div className="row" key={r.id}>
                <div className="row-body">
                  <span className="row-title">{r.title}</span>
                  <span className="row-tag">
                    {RULE_LABEL[r.rule]} · {r.target}
                    {r.unit ? ` ${r.unit}` : ''}
                  </span>
                </div>
                <button
                  className="row-del"
                  onClick={() => deleteRecurrence(r.id)}
                  aria-label={`Stop repeating ${r.title}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <span className="hint">
            Removing a repeat stops future periods. Instances already created stay put.
          </span>
        </div>
      )}
    </>
  )
}

export { GOAL_RULES, HORIZON_FOR_RULE }
