import type { ReactNode } from 'react'

export function Label({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={accent ? 'label label-accent' : 'label'}>{children}</span>
}

export function Check({ on }: { on: boolean }) {
  return <span className="check" data-on={on} />
}

/** Circular progress ring used for the day rating. */
export function Ring({ value, size = 54, stroke = 5 }: { value: number | null; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / 10))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ transition: 'stroke-dashoffset .3s ease' }}
        />
      </svg>
      <span className="ring-val" style={{ fontSize: size * 0.28 }}>
        {value == null ? '—' : value.toFixed(1)}
      </span>
    </div>
  )
}

/** Polyline chart over an array that may contain gaps. */
export function Spark({
  values,
  height = 68,
  width = 340,
  color = 'var(--accent)',
  gridlines = false,
}: {
  values: (number | null)[]
  height?: number
  width?: number
  color?: string
  gridlines?: boolean
}) {
  const present = values.filter((v): v is number => v != null)
  if (present.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--line-3)" strokeWidth="1" />
      </svg>
    )
  }
  const min = Math.min(...present)
  const max = Math.max(...present)
  const span = max - min || 1
  const pad = 6

  // Gaps break the line into separate segments rather than interpolating
  // across days with no data.
  const segments: string[] = []
  let current: string[] = []
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      return
    }
    const x = (i / (values.length - 1)) * width
    const y = height - pad - ((v - min) / span) * (height - pad * 2)
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height, overflow: 'visible' }}>
      {gridlines && (
        <>
          <line x1="0" y1={pad} x2={width} y2={pad} stroke="var(--line-3)" strokeWidth="1" />
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--line-3)" strokeWidth="1" />
          <line x1="0" y1={height - pad} x2={width} y2={height - pad} stroke="var(--line-3)" strokeWidth="1" />
        </>
      )}
      {segments.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

export function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
