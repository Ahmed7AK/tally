import { useEffect, useState } from 'react'
import {
  addMonths,
  fmtLong,
  fmtLongYear,
  monthName,
  today as todayISO,
  fromISO,
  type ISODate,
} from './lib/date'
import { useDaySummary, useHabits } from './db/hooks'
import { isSoundEnabled, playDing, setSoundEnabled } from './lib/sound'
import { Label, Ring } from './components/ui'
import JournalRail, { BestPart, TallyGrid } from './components/JournalRail'
import Install from './components/Install'
import SyncStatus from './components/SyncStatus'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import SignIn from './screens/SignIn'
import Today, { HabitChips } from './screens/Today'
import Habits from './screens/Habits'
import Goals from './screens/Goals'
import Metrics from './screens/Metrics'
import Review from './screens/Review'
import Calendar from './screens/Calendar'

type Screen = 'today' | 'calendar' | 'habits' | 'goals' | 'metrics' | 'review'
type Theme = 'dark' | 'light'

const NAV: { id: Screen; icon: string; label: string }[] = [
  { id: 'today', icon: '≡', label: 'Today' },
  { id: 'calendar', icon: '⊞', label: 'Calendar' },
  { id: 'habits', icon: '▦', label: 'Habits' },
  { id: 'goals', icon: '◔', label: 'Goals' },
  { id: 'metrics', icon: '∿', label: 'Metrics' },
  { id: 'review', icon: '⌾', label: 'Review' },
]

/** The five that fit a phone tab bar; Calendar and Journal live behind the
 *  Today screen's segmented control, as in the design. */
const MOBILE_TABS: Screen[] = ['today', 'habits', 'goals', 'metrics', 'review']

const DESKTOP_QUERY = '(min-width: 900px)'

function useIsDesktop(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const sync = () => setWide(mq.matches)
    // `resize` as well as the media query: some environments (device emulation,
    // and Safari on orientation change) resize the viewport without ever
    // dispatching the media-query `change` event.
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return wide
}

function SoundToggle() {
  const [on, setOn] = useState(isSoundEnabled)
  return (
    <button
      className="ghost-btn"
      aria-pressed={on}
      onClick={() => {
        const next = !on
        setSoundEnabled(next)
        setOn(next)
        // Play the ding when switching on, so the toggle demonstrates itself
        // and the audio context unlocks inside this gesture.
        if (next) playDing()
      }}
    >
      {on ? '♪ Sound on' : '♪̶ Sound off'}
    </button>
  )
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('tally-theme') as Theme | null) ?? 'dark',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('tally-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B0B0B' : '#F2F2F7')
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

function headingFor(screen: Screen, date: ISODate): { eyebrow: string; title: string } {
  switch (screen) {
    case 'today':
      return { eyebrow: fmtLong(date), title: date === todayISO() ? 'Today' : 'That day' }
    case 'calendar':
      return { eyebrow: String(fromISO(date).getFullYear()), title: monthName(date) }
    case 'habits':
      return { eyebrow: `${monthName(date)} ${fromISO(date).getFullYear()}`, title: 'Habits' }
    case 'goals':
      return { eyebrow: 'Quarter · month · week', title: 'Goals' }
    case 'metrics':
      return { eyebrow: 'Last 30 days', title: 'Metrics' }
    case 'review':
      return { eyebrow: 'In review', title: monthName(date) }
  }
}

function ScreenBody({
  screen,
  date,
  setDate,
}: {
  screen: Screen
  date: ISODate
  setDate: (d: ISODate) => void
}) {
  switch (screen) {
    case 'today':
      return <Today date={date} setDate={setDate} />
    case 'calendar':
      return <Calendar date={date} setDate={setDate} />
    case 'habits':
      return <Habits date={date} />
    case 'goals':
      return <Goals date={date} />
    case 'metrics':
      return <Metrics date={date} />
    case 'review':
      return <Review date={date} />
  }
}

/* --- Desktop --------------------------------------------------------------- */

function Desktop({
  screen,
  setScreen,
  date,
  setDate,
  theme,
  toggleTheme,
}: {
  screen: Screen
  setScreen: (s: Screen) => void
  date: ISODate
  setDate: (d: ISODate) => void
  theme: Theme
  toggleTheme: () => void
}) {
  const habits = useHabits()
  const heading = headingFor(screen, date)
  // Metrics reads trailing windows, so a month stepper would be misleading.
  const monthly = screen === 'habits' || screen === 'review' || screen === 'calendar'

  return (
    <div className="d-shell">
      <aside className="d-side">
        <div className="d-brand">
          <span className="d-brand-dot" />
          <span className="d-brand-name">TALLY</span>
        </div>

        <nav className="d-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className="d-nav-item"
              data-on={screen === n.id}
              onClick={() => setScreen(n.id)}
            >
              <span className="d-nav-icon">{n.icon}</span>
              <span className="d-nav-label">{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="d-side-section">
          <Label>Lists</Label>
          {habits.map((h) => (
            <div className="d-side-item" key={h.id}>
              <span className="d-side-dot" />
              <span>{h.name}</span>
            </div>
          ))}
        </div>

        <div className="d-side-foot">
          <SyncStatus />
          <SoundToggle />
          <Install />
          <button className="ghost-btn" onClick={toggleTheme}>
            {theme === 'dark' ? '☾ Dark' : '☀ Light'} — switch
          </button>
        </div>
      </aside>

      <main className="d-main">
        <div className="d-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="m-eyebrow">{screen === 'today' ? fmtLongYear(date) : heading.eyebrow}</span>
            <h1 className="d-title">{heading.title}</h1>
          </div>
          {monthly && (
            <div className="month-nav">
              <button onClick={() => setDate(addMonths(date, -1))} aria-label="Previous month">
                ‹
              </button>
              <button onClick={() => setDate(todayISO())} aria-label="This month">
                ·
              </button>
              <button onClick={() => setDate(addMonths(date, 1))} aria-label="Next month">
                ›
              </button>
            </div>
          )}
        </div>
        <ScreenBody screen={screen} date={date} setDate={setDate} />
      </main>

      <aside className="d-rail">
        <JournalRail date={date} />
      </aside>
    </div>
  )
}

/* --- Mobile ---------------------------------------------------------------- */

type MobileView = 'today' | 'calendar' | 'journal'

function Mobile({
  screen,
  setScreen,
  date,
  setDate,
  theme,
  toggleTheme,
}: {
  screen: Screen
  setScreen: (s: Screen) => void
  date: ISODate
  setDate: (d: ISODate) => void
  theme: Theme
  toggleTheme: () => void
}) {
  const [view, setView] = useState<MobileView>('today')
  const { rating } = useDaySummary(date)
  const heading = headingFor(screen, date)
  const monthly = screen === 'habits' || screen === 'review'

  return (
    <div className="m-shell">
      <header className="m-head">
        <div className="m-head-row">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="m-eyebrow">{heading.eyebrow}</span>
            <h1 className="m-title">{heading.title}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {monthly && (
              <div className="month-nav" style={{ fontSize: 16, gap: 10 }}>
                <button onClick={() => setDate(addMonths(date, -1))} aria-label="Previous month">
                  ‹
                </button>
                <button onClick={() => setDate(addMonths(date, 1))} aria-label="Next month">
                  ›
                </button>
              </div>
            )}
            {screen === 'today' && <Ring value={rating} size={54} stroke={5} />}
            {screen !== 'today' && (
              <button className="theme-toggle" onClick={toggleTheme} aria-label="Switch theme">
                {theme === 'dark' ? '☾' : '☀'}
              </button>
            )}
          </div>
        </div>

        {screen === 'today' && (
          <div className="seg">
            {(['today', 'calendar', 'journal'] as MobileView[]).map((v) => (
              <button key={v} className="seg-btn" data-on={view === v} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="m-scroll">
        {screen === 'today' ? (
          view === 'today' ? (
            <>
              <Today date={date} setDate={setDate} />
              <HabitChips date={date} />
              {/* Logging lives here rather than only at the bottom of Metrics —
                  weight, hours and screen time get entered daily. */}
              <div className="section">
                <Label>Today's tally</Label>
                <TallyGrid date={date} />
              </div>
              <BestPart date={date} />
              <SyncStatus />
              <SoundToggle />
              <Install />
            </>
          ) : view === 'calendar' ? (
            <Calendar date={date} setDate={setDate} />
          ) : (
            <JournalRail date={date} />
          )
        ) : (
          <ScreenBody screen={screen} date={date} setDate={setDate} />
        )}
      </div>

      <nav className="m-tabs">
        {MOBILE_TABS.map((id) => {
          const n = NAV.find((x) => x.id === id)!
          return (
            <button key={id} className="m-tab" data-on={screen === id} onClick={() => setScreen(id)}>
              <span className="m-tab-icon">{n.icon}</span>
              <span className="m-tab-label">{n.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/* --- Root ------------------------------------------------------------------ */

function Shell() {
  const isDesktop = useIsDesktop()
  const [theme, toggleTheme] = useTheme()
  const [screen, setScreen] = useState<Screen>('today')
  const [date, setDate] = useState<ISODate>(todayISO)
  const { loading, session, syncEnabled } = useAuth()

  // Reading the persisted session is fast, but rendering the app and then
  // yanking it away would flash content that may not belong to this account.
  if (loading) return <div className="app" />

  // With no Supabase credentials the app is a local-only tracker and the gate
  // would be a dead end, so it is skipped entirely.
  if (syncEnabled && !session) return <SignIn />

  const props = { screen, setScreen, date, setDate, theme, toggleTheme }
  return <div className="app">{isDesktop ? <Desktop {...props} /> : <Mobile {...props} />}</div>
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
