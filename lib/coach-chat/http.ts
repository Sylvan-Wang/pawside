import type { SupabaseClient, User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { apiError } from '../api/response'
import { createClient } from '../supabase/server'
import { coachChatEnabledFor } from './flags'

/**
 * Every chat endpoint starts here: signed in, and the assistant is on for this
 * user. The check is on the server on purpose - hiding the button in the app is
 * a convenience, not access control.
 */
export async function requireCoachUser(): Promise<
  { ok: true; supabase: SupabaseClient; user: User } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, response: apiError('UNAUTHORIZED', '请先登录', 401) }
  if (!(await coachChatEnabledFor(supabase))) {
    return { ok: false, response: apiError('FEATURE_DISABLED', '小爪暂时没有对你开放', 403) }
  }
  return { ok: true, supabase, user }
}
