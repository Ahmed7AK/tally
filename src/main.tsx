import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { dropLegacyDatabase } from './db/db'
import './styles/tokens.css'
import './styles/app.css'

// Theme is applied before first paint so the shell never flashes the wrong one.
document.documentElement.dataset.theme = localStorage.getItem('tally-theme') ?? 'dark'

// The pre-sync build's seeded database is incompatible and unwanted; drop it.
// Fire-and-forget — nothing reads it, so rendering need not wait.
void dropLegacyDatabase()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
