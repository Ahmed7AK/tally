/* ---------------------------------------------------------------------------
   Completion sound.

   Synthesised with the Web Audio API rather than shipped as a file: it costs
   nothing to download, works offline with no cache entry, and can be tuned
   here. The timbre is a struck bell — a bright fundamental with two quieter
   partials above it and a fast exponential decay.
   --------------------------------------------------------------------------- */

const STORAGE_KEY = 'tally-sound'

let ctx: AudioContext | null = null

export function isSoundEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

export function setSoundEnabled(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  // Unlock the context while we are still inside the click that toggled it —
  // iOS only allows audio to start from a user gesture.
  if (on) void ensureContext()
}

async function ensureContext(): Promise<AudioContext | null> {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx ??= new Ctor()
  // Safari suspends the context until a gesture resumes it; every caller here
  // is already inside one.
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      return null
    }
  }
  return ctx
}

/** Partials as [frequency, peak gain, seconds]. C6 with a fifth and an octave
 *  above it reads as a "ding" rather than a plain beep. */
const PARTIALS: [number, number, number][] = [
  [1046.5, 0.5, 0.42],
  [1568.0, 0.22, 0.3],
  [2093.0, 0.1, 0.22],
]

/** Plays the completion ding. No-op when muted or when audio is unavailable.
 *  Must be called from within a user gesture on iOS. */
export function playDing(): void {
  if (!isSoundEnabled()) return

  void ensureContext().then((c) => {
    if (!c) return
    const now = c.currentTime

    const master = c.createGain()
    master.gain.value = 0.35
    master.connect(c.destination)

    for (const [freq, peak, dur] of PARTIALS) {
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)

      // A near-instant attack gives the strike; exponential decay gives the
      // ring. Ramping to exactly 0 is invalid, hence the tiny floor.
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

      osc.connect(gain)
      gain.connect(master)
      osc.start(now)
      osc.stop(now + dur + 0.02)
    }
  })
}
