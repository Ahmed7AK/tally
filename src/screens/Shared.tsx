import { useEffect, useState } from 'react'
import { fetchSharedTopic, type SharedGoal, type SharedTopic } from '../lib/share'
import { Bar, Check, Label } from '../components/ui'

const HORIZONS: SharedGoal['horizon'][] = ['quarter', 'month', 'week']

function GoalLine({ g, showProgress }: { g: SharedGoal; showProgress: boolean }) {
  // Without numbers there is nothing to fill a bar with, so completed/not is
  // shown as a checkbox instead.
  if (!showProgress || g.target == null || g.current == null) {
    return (
      <div className="row">
        <Check on={g.done} />
        <span className={g.done ? 'row-title strike' : 'row-title'} style={{ flex: 1 }}>
          {g.title}
        </span>
      </div>
    )
  }

  const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0
  return (
    <div className="goal-item">
      <div className="goal-top">
        <span className="goal-title">{g.title}</span>
        <span className="goal-pct">{pct}%</span>
      </div>
      <Bar pct={pct} />
      <span className="goal-sub">
        {g.current} / {g.target}
        {g.unit ? ` ${g.unit}` : ''}
      </span>
    </div>
  )
}

export default function Shared({ token }: { token: string }) {
  const [topic, setTopic] = useState<SharedTopic | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchSharedTopic(token)
      .then(setTopic)
      .catch((e: Error) => setError(e.message))
  }, [token])

  if (error) {
    return (
      <div className="signin">
        <div className="signin-card">
          <div className="d-brand" style={{ padding: 0 }}>
            <span className="d-brand-dot" />
            <span className="d-brand-name">TALLY</span>
          </div>
          <h1 className="signin-title">Link not active</h1>
          <p className="signin-copy">{error}</p>
        </div>
      </div>
    )
  }

  if (!topic) {
    return (
      <div className="signin">
        <div className="signin-card">
          <span className="hint">Loading…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="shared">
      <div className="shared-inner">
        <header className="shared-head">
          <div className="d-brand" style={{ padding: 0 }}>
            <span className="d-brand-dot" />
            <span className="d-brand-name">TALLY</span>
          </div>
          <h1 className="shared-title">{topic.name}</h1>
          {topic.position && <span className="topic-position">{topic.position}</span>}
          {topic.summary && <p className="shared-summary">{topic.summary}</p>}
        </header>

        {topic.goals.length === 0 && <div className="card"><div className="empty">No goals set yet.</div></div>}

        {HORIZONS.map((h) => {
          const items = topic.goals.filter((g) => g.horizon === h)
          if (items.length === 0) return null
          return (
            <div className="goal-group" key={h}>
              <div className="goal-group-head">
                <Label accent>{h}</Label>
                <span className="goal-sub">{items[0].label}</span>
              </div>
              <div className="rows">
                {items.map((g, i) => (
                  <GoalLine key={`${g.title}-${i}`} g={g} showProgress={topic.showProgress} />
                ))}
              </div>
            </div>
          )
        })}

        <p className="shared-foot">Read-only view · shared from Tally</p>
      </div>
    </div>
  )
}
