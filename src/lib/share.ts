import { supabase } from './supabase'

/* ---------------------------------------------------------------------------
   Read-only topic share links.

   The link is *unlisted*, not private: unguessable, but anyone it reaches can
   open it and it can be forwarded. Rotating the token is the revocation
   mechanism, and turning sharing off breaks every link at once.
   --------------------------------------------------------------------------- */

export interface SharedGoal {
  horizon: 'quarter' | 'month' | 'week'
  label: string
  title: string
  current: number | null
  target: number | null
  unit: string | null
  done: boolean
}

export interface SharedTopic {
  name: string
  position: string
  summary: string | null
  showProgress: boolean
  goals: SharedGoal[]
}

/** 24 bytes of entropy, hex — the same shape as the quick-capture tokens. */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Query parameter rather than a path, so no host rewrite rule is needed and
 *  the link keeps working on any deployment. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/?s=${token}`
}

export function shareTokenFromUrl(): string | null {
  const token = new URLSearchParams(window.location.search).get('s')
  return token && token.length >= 16 ? token : null
}

/** Fetches a shared topic. Works signed out — that is the whole point. */
export async function fetchSharedTopic(token: string): Promise<SharedTopic> {
  if (!supabase) throw new Error('Sharing is not configured on this deployment.')
  const { data, error } = await supabase.rpc('get_shared_topic', { p_token: token })
  if (error) {
    // The function reports one error for every failure mode on purpose.
    throw new Error(
      error.message === 'not found'
        ? 'This link is no longer active.'
        : error.message,
    )
  }
  return data as SharedTopic
}
