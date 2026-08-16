import { useState } from 'react'
import { updateTopic } from '../db/hooks'
import { newShareToken, shareUrl } from '../lib/share'
import type { Topic } from '../db/db'
import { Label } from './ui'

/** Share controls for one topic. The link is unlisted rather than private:
 *  unguessable, but forwardable by anyone who receives it. */
export default function ShareTopic({ topic }: { topic: Topic }) {
  const [copied, setCopied] = useState(false)
  const on = topic.shared === 1
  const url = topic.shareToken ? shareUrl(topic.shareToken) : ''

  async function toggle() {
    if (on) {
      await updateTopic(topic.id, { shared: 0 })
    } else {
      // Mint on first enable; reuse the existing token afterwards so previously
      // shared links keep working when it is toggled off and on again.
      await updateTopic(topic.id, {
        shared: 1,
        shareToken: topic.shareToken ?? newShareToken(),
      })
    }
    setCopied(false)
  }

  async function rotate() {
    await updateTopic(topic.id, { shareToken: newShareToken() })
    setCopied(false)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="share">
      <button className="ghost-btn" onClick={() => void toggle()} aria-pressed={on}>
        {on ? '🔗 Sharing on' : '🔗 Share read-only link'}
      </button>

      {on && (
        <>
          <code className="capture-code">{url}</code>
          <div className="field-actions">
            <button className="btn-primary" onClick={() => void copy()}>
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
            <button className="ghost-btn" onClick={() => void rotate()}>
              Rotate
            </button>
          </div>

          <Label>Visible to viewers</Label>
          <label className="field-check">
            <input
              type="checkbox"
              checked={topic.shareProgress === 1}
              onChange={(e) => void updateTopic(topic.id, { shareProgress: e.target.checked ? 1 : 0 })}
            />
            <span>Progress numbers — off shows only which goals are done</span>
          </label>
          <label className="field-check">
            <input
              type="checkbox"
              checked={topic.shareSummary === 1}
              onChange={(e) => void updateTopic(topic.id, { shareSummary: e.target.checked ? 1 : 0 })}
            />
            <span>Summary</span>
          </label>

          <span className="hint">
            Anyone with this link can view — it can be forwarded. Rotate to break old links;
            switching sharing off breaks them all.
          </span>
        </>
      )}
    </div>
  )
}
