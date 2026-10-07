import { apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { loadEncryptionKey } from './crypto'
import { ouraConfig } from './oura'
import { supabaseDeviceStore } from './store'

export const OURA_FEATURE = 'oura_beta'
export const STATE_COOKIE = 'pawside_oura_state'

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** Signed-in user + whether the Oura beta is switched on for them. */
export async function ouraUser(): Promise<
  | { ok: true; supabase: ServerClient; userId: string; enabled: boolean }
  | { ok: false; response: Response }
> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, response: apiError('UNAUTHORIZED', '请先登录', 401) }
  const { data } = await supabase.rpc('feature_enabled', { p_key: OURA_FEATURE })
  return { ok: true, supabase, userId: user.id, enabled: data === true }
}

/** Server-side pieces needed to talk to Oura and store the result, or null if anything is not configured. */
export function ouraServer() {
  const config = ouraConfig()
  const key = loadEncryptionKey()
  const admin = createAdminClient()
  if (!config || !key || !admin) return null
  return { config, key, store: supabaseDeviceStore(admin) }
}
