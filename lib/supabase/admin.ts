import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. SERVER ONLY: it bypasses row-level security, so it may be
 * used only after the caller has been authenticated, and never imported from a
 * client component. Returns null when the key is not configured so callers can
 * fail with an honest message instead of pretending to succeed.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
