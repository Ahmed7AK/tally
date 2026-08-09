import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Sync is optional. With no credentials configured the app still runs as a
 *  purely local tracker — every sync entry point checks this first rather than
 *  throwing at import time. */
export const isSyncConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSyncConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The magic link lands back on the app with tokens in the URL.
        detectSessionInUrl: true,
        storageKey: 'tally-auth',
      },
    })
  : null
