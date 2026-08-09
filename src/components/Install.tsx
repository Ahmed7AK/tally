import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates the display-mode media query.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** Chromium fires `beforeinstallprompt` and lets us trigger the install
 *  ourselves. Safari (macOS and iOS) never fires it, so there we can only tell
 *  the user where the menu item lives. */
export default function Install() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return null

  if (deferred) {
    return (
      <button
        className="ghost-btn"
        onClick={async () => {
          await deferred.prompt()
          await deferred.userChoice
          setDeferred(null)
        }}
      >
        ⤓ Install Tally
      </button>
    )
  }

  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const hint = iOS
    ? 'Share → Add to Home Screen'
    : 'Safari: File → Add to Dock. Chrome: ⋮ → Cast, save & share → Install.'

  return (
    <>
      <button className="ghost-btn" onClick={() => setShowHint((v) => !v)}>
        ⤓ Install Tally
      </button>
      {showHint && (
        <span style={{ fontSize: 12, color: 'var(--dim-2)', lineHeight: 1.4, padding: '0 4px' }}>{hint}</span>
      )}
    </>
  )
}
