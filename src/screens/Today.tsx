import { useMemo, useRef, useState } from 'react'
import {
  addRecurrence,
  addTask,
  deleteRecurrence,
  deleteTask,
  reorderSubtasks,
  reorderTasks,
  toggleHabit,
  toggleTask,
  updateTask,
  useDaySummary,
  useMaterialise,
  useRatingSeries,
  useRecurrences,
  useSubtasks,
} from '../db/hooks'
import { useDragSort } from '../components/useDragSort'
import type { Task } from '../db/db'
import { DOW_SHORT, fmtLong, fromISO, today as todayISO, weekDates, type ISODate } from '../lib/date'
import { formatTime, parseTaskInput } from '../lib/parse'
import { RULE_LABEL } from '../lib/recur'
import { playDing } from '../lib/sound'
import { Check, Label } from '../components/ui'

export function WeekStrip({ date, setDate }: { date: ISODate; setDate: (d: ISODate) => void }) {
  const dates = weekDates(date)
  const series = useRatingSeries(dates[6], 7)
  const ratings = Object.fromEntries(series.map((s) => [s.date, s.rating]))

  return (
    <div className="week">
      {dates.map((d, i) => {
        const r = ratings[d]
        return (
          <button key={d} className="week-day" data-on={d === date} onClick={() => setDate(d)}>
            <span className="week-dow">{DOW_SHORT[i].slice(0, 3)}</span>
            <span className="week-num">{fromISO(d).getDate()}</span>
            <span
              className="week-dot"
              style={
                d === date
                  ? undefined
                  : { background: r == null ? 'var(--line-3)' : r >= 7 ? 'var(--accent)' : 'var(--ring-off)' }
              }
            />
          </button>
        )
      })}
    </div>
  )
}

/** "2 days late" — how far the task has been carried. */
function lateLabel(from: ISODate, now: ISODate): string {
  const days = Math.round((fromISO(now).getTime() - fromISO(from).getTime()) / 86_400_000)
  if (days <= 0) return 'Overdue'
  return days === 1 ? '1 day late' : `${days} days late`
}

/** Inline title editor, shared by tasks and sub-tasks. */
function TitleEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const [value, setValue] = useState(task.title)
  return (
    <form
      className="row row-editing"
      onSubmit={async (e) => {
        e.preventDefault()
        const title = value.trim()
        if (title) await updateTask(task.id, { title })
        onDone()
      }}
    >
      <input
        autoFocus
        className="row-edit-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        onBlur={onDone}
        aria-label={`Edit ${task.title}`}
      />
    </form>
  )
}

function SubtaskList({
  parentId,
  subs,
  date,
}: {
  parentId: string
  subs: Task[]
  date: ISODate
}) {
  const { containerRef, draggingIndex, gripProps } = useDragSort(
    subs.length,
    (from, to) => void reorderSubtasks(date, parentId, from, to),
    'Reorder sub-task',
  )
  return (
    <div ref={containerRef} className="sortable">
      {subs.map((c, i) => (
        <SubtaskRow
          task={c}
          key={c.id}
          dragging={draggingIndex === i}
          grip={subs.length > 1 ? <Grip {...gripProps(i)} /> : null}
        />
      ))}
    </div>
  )
}

function SubtaskRow({
  task,
  grip,
  dragging,
}: {
  task: Task
  grip: React.ReactNode
  dragging: boolean
}) {
  const [editing, setEditing] = useState(false)
  if (editing) return <TitleEditor task={task} onDone={() => setEditing(false)} />

  return (
    <div className="row row-sub" data-sortable="true" data-dragging={dragging}>
      {grip}
      <button
        onClick={() => {
          if (!task.done) playDing()
          void toggleTask(task)
        }}
        aria-label={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
      >
        <Check on={task.done} />
      </button>
      <span
        className={task.done ? 'row-title strike' : 'row-title'}
        style={{ flex: 1 }}
        onDoubleClick={() => setEditing(true)}
      >
        {task.title}
      </span>
      <button className="row-del" onClick={() => setEditing(true)} aria-label={`Edit ${task.title}`}>
        ✎
      </button>
      <button className="row-del" onClick={() => deleteTask(task.id)} aria-label={`Delete ${task.title}`}>
        ×
      </button>
    </div>
  )
}

/** The drag grip. Kept as its own element so dragging never competes with
 *  scrolling or with tapping the checkbox. */
function Grip(props: ReturnType<ReturnType<typeof useDragSort>['gripProps']>) {
  return (
    <span className="grip" {...props}>
      ⠿
    </span>
  )
}

function TaskRow({
  task,
  subs,
  date,
  grip,
  dragging,
}: {
  task: Task
  subs: Task[]
  date: ISODate
  grip: React.ReactNode
  dragging: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const subInput = useRef<HTMLInputElement>(null)

  const doneCount = subs.filter((c) => c.done).length
  const hasChildren = subs.length > 0
  const open = expanded

  async function addSub(e: React.FormEvent) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    await addTask(date, title, '', '', task.id)
    setDraft('')
    subInput.current?.focus()
  }

  return (
    // One wrapper per task so the drag hook has something to measure, and so
    // dragging a parent carries its sub-tasks with it.
    <div className="sortable-item" data-sortable="true" data-dragging={dragging}>
      {editing ? (
        <TitleEditor task={task} onDone={() => setEditing(false)} />
      ) : (
        <div className="row" data-overdue={Boolean(task.overdueFrom) && !task.done}>
          {grip}
          <button
            onClick={() => {
              if (!task.done) playDing()
              void toggleTask(task)
            }}
            aria-label={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
          >
            <Check on={task.done} />
          </button>

          <button
            className="row-expander"
            data-open={open}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={open}
            aria-label={open ? `Collapse ${task.title}` : `Expand ${task.title}`}
          >
            ▸
          </button>

          <div className="row-body" onDoubleClick={() => setEditing(true)}>
            <span className={task.done ? 'row-title strike' : 'row-title'}>
              {task.title}
              {task.recurrenceId && (
                <span className="repeat-badge" title="Repeating">
                  ↻
                </span>
              )}
            </span>
            <span className="row-tag">
              {task.overdueFrom && !task.done && (
                <span className="overdue-badge">{lateLabel(task.overdueFrom, date)}</span>
              )}
              {task.tag}
              {hasChildren && (
                <span className="sub-count">
                  {task.tag || task.overdueFrom ? ' · ' : ''}
                  {doneCount}/{subs.length}
                </span>
              )}
            </span>
          </div>

          {task.time && <span className="row-time">{formatTime(task.time)}</span>}
          <button className="row-del" onClick={() => setEditing(true)} aria-label={`Edit ${task.title}`}>
            ✎
          </button>
          <button className="row-del" onClick={() => deleteTask(task.id)} aria-label={`Delete ${task.title}`}>
            ×
          </button>
        </div>
      )}

      {open && (
        <>
          <SubtaskList parentId={task.id} subs={subs} date={date} />
          <form className="row row-sub row-sub-add" onSubmit={addSub}>
            <span className="row-add-glyph">＋</span>
            <input
              ref={subInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setDraft('')}
              placeholder="Add sub-task"
              aria-label={`Add sub-task to ${task.title}`}
            />
          </form>
        </>
      )}
    </div>
  )
}

export function TaskList({ date }: { date: ISODate }) {
  const { tasks } = useDaySummary(date)
  const subtasks = useSubtasks(date)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { containerRef, draggingIndex, gripProps } = useDragSort(
    tasks.length,
    (from, to) => void reorderTasks(date, from, to),
    'Reorder task',
  )

  // Parsed on every keystroke so the preview shows what will actually be saved.
  const parsed = useMemo(() => (draft.trim() ? parseTaskInput(draft, date) : null), [draft, date])
  const showPreview = Boolean(parsed && (parsed.timeMatched || parsed.dateMatched || parsed.repeat))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!parsed || !parsed.title) return

    if (parsed.repeat) {
      // A repeat creates a template; materialisation makes today's instance.
      await addRecurrence({
        kind: 'task',
        rule: parsed.repeat,
        title: parsed.title,
        time: parsed.time,
        tag: '',
        horizon: 'week',
        target: 1,
        unit: '',
        startDate: date,
        weekday: parsed.repeatWeekday,
      })
    } else {
      await addTask(parsed.date, parsed.title, parsed.time)
    }

    setDraft('')
    inputRef.current?.focus()
  }

  return (
    <div className="rows">
      <form className="row-add" onSubmit={submit}>
        <span className="row-add-glyph">＋</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft('')
              inputRef.current?.blur()
            }
          }}
          placeholder="Add task — try “read Dune 4pm” or “gym every day”"
          aria-label="Add task"
          enterKeyHint="done"
        />
      </form>

      {showPreview && parsed && (
        <div className="row-preview">
          <span className="row-preview-title">{parsed.title}</span>
          {parsed.timeMatched && <span className="row-preview-chip">{formatTime(parsed.time)}</span>}
          {parsed.dateMatched && parsed.date !== date && (
            <span className="row-preview-chip">{fmtLong(parsed.date)}</span>
          )}
          {parsed.repeat && <span className="row-preview-chip">↻ {RULE_LABEL[parsed.repeat]}</span>}
        </div>
      )}

      {tasks.length === 0 && !showPreview && <div className="empty">Nothing planned for this day.</div>}

      <div ref={containerRef} className="sortable">
        {tasks.map((t, i) => (
          <TaskRow
            task={t}
            subs={subtasks[t.id] ?? []}
            date={date}
            key={t.id}
            dragging={draggingIndex === i}
            grip={tasks.length > 1 ? <Grip {...gripProps(i)} /> : null}
          />
        ))}
      </div>
    </div>
  )
}

export function HabitChips({ date }: { date: ISODate }) {
  const { habits, logs } = useDaySummary(date)
  return (
    <div className="chips">
      {habits.map((h) => {
        const on = !!logs[h.id]
        return (
          <button
            key={h.id}
            className="chip"
            data-on={on}
            onClick={() => {
              if (!on) playDing()
              void toggleHabit(date, h.id, on)
            }}
            aria-pressed={on}
          >
            <span className="chip-mark">{on ? '✓' : '·'}</span>
            <span className="chip-name">{h.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Active task templates, with a way to stop them. */
export function RepeatingTasks() {
  const recurrences = useRecurrences('task')
  if (recurrences.length === 0) return null
  return (
    <div className="section">
      <Label>Repeating tasks</Label>
      <div className="rows">
        {recurrences.map((r) => (
          <div className="row" key={r.id}>
            <div className="row-body">
              <span className="row-title">{r.title}</span>
              <span className="row-tag">
                {RULE_LABEL[r.rule]}
                {r.time ? ` · ${formatTime(r.time)}` : ''}
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
      <span className="hint">Stopping a repeat leaves days already generated untouched.</span>
    </div>
  )
}

export default function Today({ date, setDate }: { date: ISODate; setDate: (d: ISODate) => void }) {
  useMaterialise(date)
  const isToday = date === todayISO()
  return (
    <>
      <WeekStrip date={date} setDate={setDate} />
      <TaskList date={date} />
      <RepeatingTasks />
      {!isToday && (
        <button className="ghost-btn" onClick={() => setDate(todayISO())}>
          ← Back to today
        </button>
      )}
    </>
  )
}
