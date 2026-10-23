import { NextResponse } from 'next/server'
import { coachChatEnabledFor } from '@/lib/coach-chat/flags'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/coach/status -> { data: { enabled } }
 * The app asks this once to decide whether to show the assistant at all. Not
 * signed in, kill switch on, or not granted: all simply "not enabled".
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ data: { enabled: false } })
  return NextResponse.json({ data: { enabled: await coachChatEnabledFor(supabase) } })
}
