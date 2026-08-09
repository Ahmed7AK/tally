import { setMetric, useMetric, useRatingSeries, useTrailingMetrics } from '../db/hooks'
import { fromISO, monthName, today as todayISO, type ISODate } from '../lib/date'
import { Label, Spark } from '../components/ui'

function axisLabel(d: ISODate): string {
  return `${fromISO(d).getDate()} ${monthName(d).slice(0, 3).toUpperCase()}`
}

function NumberField({
  label,
  value,
  unit,
  step,
  onCommit,
}: {
  label: string
  value: number | undefined
  unit: string
  step: number
  onCommit: (n: number) => void
}) {
  return (
    <div className="metric-input">
      <span style={{ flex: '0 0 auto', minWidth: 52 }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        placeholder="—"
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (e.target.value !== '' && !Number.isNaN(n)) onCommit(n)
        }}
      />
      <span>{unit}</span>
    </div>
  )
}

export default function Metrics({ date }: { date: ISODate }) {
  const month = useTrailingMetrics(date, 30)
  const fortnight = useTrailingMetrics(date, 14)
  const ratings = useRatingSeries(date, 30)
  const t0 = todayISO()
  const todayMetric = useMetric(t0)

  const weights = month.map((r) => r.weight ?? null)
  const hours = fortnight.map((r) => r.hours ?? null)
  const latestWeight = [...weights].reverse().find((w) => w != null) ?? null
  const latestHours = [...hours].reverse().find((h) => h != null) ?? null
  const ratingVals = ratings.map((r) => r.rating)
  const latestRating = [...ratingVals].reverse().find((r) => r != null) ?? null
  const maxHours = Math.max(1, ...hours.filter((h): h is number => h != null))

  return (
    <>
      <div className="metric-card">
        <div className="metric-head">
          <Label>Weight / kg</Label>
          <span className="metric-val">{latestWeight?.toFixed(1) ?? '—'}</span>
        </div>
        <Spark values={weights} height={128} width={320} gridlines />
        <div className="metric-axis">
          <span>{axisLabel(month[0]?.date ?? date)}</span>
          <span>{axisLabel(month[month.length - 1]?.date ?? date)}</span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-head">
          <Label>Hours worked</Label>
          <span className="metric-val">{latestHours?.toFixed(1) ?? '—'}</span>
        </div>
        <div className="bars">
          {hours.map((h, i, arr) => (
            <div
              key={i}
              data-on={i === arr.length - 1}
              style={{ height: `${((h ?? 0) / maxHours) * 100}%` }}
            />
          ))}
        </div>
        <div className="metric-axis">
          <span>{axisLabel(fortnight[0]?.date ?? date)}</span>
          <span>{axisLabel(fortnight[fortnight.length - 1]?.date ?? date)}</span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-head">
          <Label>Day rating</Label>
          <span className="metric-val" data-accent="true">
            {latestRating?.toFixed(1) ?? '—'}
          </span>
        </div>
        <Spark values={ratingVals} height={74} width={340} color="var(--fg-2)" />
        <span style={{ fontSize: 12, color: 'var(--dim-2)', lineHeight: 1.4 }}>
          Auto-scored from tasks completed and habits ticked.
        </span>
      </div>

      <div className="metric-card">
        <Label>Log today</Label>
        <NumberField
          label="Weight"
          unit="kg"
          step={0.1}
          value={todayMetric?.weight}
          onCommit={(n) => setMetric(t0, { weight: n })}
        />
        <NumberField
          label="Hours"
          unit="hrs"
          step={0.5}
          value={todayMetric?.hours}
          onCommit={(n) => setMetric(t0, { hours: n })}
        />
        <NumberField
          label="Screen"
          unit="hrs"
          step={0.1}
          value={todayMetric?.screen}
          onCommit={(n) => setMetric(t0, { screen: n })}
        />
      </div>
    </>
  )
}
