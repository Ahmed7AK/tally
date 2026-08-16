import { useEffect, useState } from 'react'
import {
  addGoal,
  addRecurrence,
  addTopic,
  deleteGoal,
  deleteRecurrence,
  deleteTopic,
  reorderGoals,
  reorderTopics,
  rolloverGoals,
  setGoalProgress,
  updateGoal,
  updateTopic,
  useGoals,
  useMaterialise,
  useRecurrences,
  useTopics,
} from '../db/hooks'
import { addDays, fmtRange, monthName, quarterOf, startOfWeek, type ISODate } from '../lib/date'
import { HORIZON_FOR_RULE, RULE_LABEL } from '../lib/recur'
import { playDing } from '../lib/sound'
import { useDragSort } from '../components/useDragSort'
import ShareTopic from '../components/ShareTopic'
import { Bar, Check, Label } from '../components/ui'
import type { Goal, Horizon, RepeatRule, Topic } from '../db/db'

const HORIZONS: Horizon[] = ['quarter', 'month', 'week']

const RULE_FOR_HORIZON: Record<Horizon, RepeatRule> = {
  quarter: 'quarterly',
  month: 'monthly',
  week: 'weekly',
}

/** The drag grip. Its own element so dragging never competes with scrolling
 *  or with tapping the checkbox and steppers. */
function Grip(props: ReturnType<ReturnType<typeof useDragSort>['gripProps']>) {
  return (
    <span className="grip" {...props}>
      ⠿
    </span>
  )
}

/* --- goals ---------------------------------------------------------------- */

/** Inline editor. Goals were once write-once, so a slip in the unit field
 *  could only be fixed by deleting and retyping. */
function GoalEditor({ g, onDone }: { g: Goal; onDone: () => void }) {
  const [title, setTitle] = useState(g.title)
  const [target, setTarget] = useState(String(g.target))
  const [unit, setUnit] = useState(g.unit)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await updateGoal(g.id, { title: title.trim(), target: Number(target) || 1, unit: unit.trim() })
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

function GoalRow({ g, grip }: { g: Goal; grip: React.ReactNode }) {
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
        {grip}
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
          {grip}
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
  topicId,
  onDone,
}: {
  horizon: Horizon
  label: string
  topicId?: string
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
        topicId,
      })
    } else {
      await addGoal(horizon, label, title.trim(), numericTarget, unit.trim(), topicId)
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
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="170" />
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

/** One horizon's worth of goals. Shared by the personal list and every topic,
 *  so they cannot drift apart in behaviour. */
function GoalGroup({
  horizon,
  label,
  items,
  topicId,
}: {
  horizon: Horizon
  label: string
  items: Goal[]
  topicId?: string
}) {
  const [adding, setAdding] = useState(false)
  const { containerRef, draggingIndex, gripProps } = useDragSort(
    items.length,
    (from, to) => void reorderGoals(horizon, label, from, to, topicId),
    'Reorder goal',
  )

  return (
    <div className="goal-group">
      <div className="goal-group-head">
        <Label accent>{horizon}</Label>
        <span className="goal-sub">{label}</span>
      </div>
      <div className="rows">
        {items.length === 0 && !adding && <div className="empty">Nothing set for this {horizon} yet.</div>}
        <div ref={containerRef} className="sortable">
          {items.map((g, i) => (
            <div
              className="sortable-item"
              data-sortable="true"
              data-dragging={draggingIndex === i}
              key={g.id}
            >
              <GoalRow g={g} grip={items.length > 1 ? <Grip {...gripProps(i)} /> : null} />
            </div>
          ))}
        </div>
        {adding && (
          <AddGoalForm horizon={horizon} label={label} topicId={topicId} onDone={() => setAdding(false)} />
        )}
      </div>
      {!adding && (
        <button className="ghost-btn" onClick={() => setAdding(true)}>
          ＋ New {horizon} goal
        </button>
      )}
    </div>
  )
}

/* --- topics --------------------------------------------------------------- */

function TopicForm({
  topic,
  onDone,
}: {
  topic?: Topic
  onDone: () => void
}) {
  const [name, setName] = useState(topic?.name ?? '')
  const [position, setPosition] = useState(topic?.position ?? '')
  const [summary, setSummary] = useState(topic?.summary ?? '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (topic) await updateTopic(topic.id, { name: name.trim(), position: position.trim(), summary: summary.trim() })
    else await addTopic(name.trim(), position.trim(), summary.trim())
    onDone()
  }

  return (
    <form className="topic-form" onSubmit={submit}>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Topic</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Robotics club"
          />
        </label>
        <label className="field">
          <span className="field-label">Your position</span>
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="Treasurer"
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Summary — optional</span>
        <textarea
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What this is and what you're responsible for."
        />
      </label>
      <div className="field-actions">
        <button type="submit" className="btn-primary">
          {topic ? 'Save' : 'Add topic'}
        </button>
        <button type="button" className="ghost-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function TopicCard({
  topic,
  goals,
  labelFor,
  grip,
}: {
  topic: Topic
  goals: Goal[]
  labelFor: Record<Horizon, string>
  grip: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  const mine = goals.filter((g) => g.topicId === topic.id)
  const done = mine.filter((g) => g.current >= g.target).length

  if (editing) {
    return (
      <div className="topic-card">
        <TopicForm topic={topic} onDone={() => setEditing(false)} />
      </div>
    )
  }

  return (
    <div className="topic-card" data-open={open}>
      <div className="topic-head">
        {grip}
        <button
          className="row-expander"
          data-open={open}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${topic.name}` : `Expand ${topic.name}`}
        >
          ▸
        </button>
        <div className="topic-id" onDoubleClick={() => setEditing(true)}>
          <span className="topic-name">{topic.name}</span>
          {topic.position && <span className="topic-position">{topic.position}</span>}
        </div>
        <span className="topic-count">
          {done}/{mine.length}
        </span>
        <button className="row-del" onClick={() => setEditing(true)} aria-label={`Edit ${topic.name}`}>
          ✎
        </button>
        <button
          className="row-del"
          onClick={() => {
            if (confirm(`Delete “${topic.name}” and its ${mine.length} goal(s)?`)) void deleteTopic(topic.id)
          }}
          aria-label={`Delete ${topic.name}`}
        >
          ×
        </button>
      </div>

      {topic.summary && <p className="topic-summary">{topic.summary}</p>}

      {open && (
        <div className="topic-body">
          <ShareTopic topic={topic} />
          {HORIZONS.map((h) => (
            <GoalGroup
              key={h}
              horizon={h}
              label={labelFor[h]}
              topicId={topic.id}
              items={mine.filter((g) => g.horizon === h && g.label === labelFor[h])}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TopicsSection({ goals, labelFor }: { goals: Goal[]; labelFor: Record<Horizon, string> }) {
  const topics = useTopics()
  const [adding, setAdding] = useState(false)
  const { containerRef, draggingIndex, gripProps } = useDragSort(
    topics.length,
    (from, to) => void reorderTopics(from, to),
    'Reorder topic',
  )

  return (
    <div className="section topics">
      <div className="goal-group-head">
        <Label accent>Topics</Label>
        <span className="goal-sub">{topics.length} tracked</span>
      </div>

      {topics.length === 0 && !adding && (
        <div className="card">
          <div className="empty">
            No topics yet. Add a club, a company or any other commitment and give it its own
            quarterly, monthly and weekly goals.
          </div>
        </div>
      )}

      <div ref={containerRef} className="sortable topic-list">
        {topics.map((t, i) => (
          <div
            className="sortable-item"
            data-sortable="true"
            data-dragging={draggingIndex === i}
            key={t.id}
          >
            <TopicCard
              topic={t}
              goals={goals}
              labelFor={labelFor}
              grip={topics.length > 1 ? <Grip {...gripProps(i)} /> : null}
            />
          </div>
        ))}
      </div>

      {adding ? (
        <div className="topic-card">
          <TopicForm onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button className="ghost-btn" onClick={() => setAdding(true)}>
          ＋ New topic
        </button>
      )}
    </div>
  )
}

/* --- screen --------------------------------------------------------------- */

export default function Goals({ date }: { date: ISODate }) {
  useMaterialise(date)
  const goals = useGoals()
  const recurrences = useRecurrences('goal')

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

  const personal = goals.filter((g) => !g.topicId)

  return (
    <>
      {HORIZONS.map((h) => (
        <GoalGroup
          key={h}
          horizon={h}
          label={labelFor[h]}
          items={personal.filter((g) => g.horizon === h && g.label === labelFor[h])}
        />
      ))}

      <TopicsSection goals={goals} labelFor={labelFor} />

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

export { HORIZON_FOR_RULE }
