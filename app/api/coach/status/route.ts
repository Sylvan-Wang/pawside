import { NextResponse } from 'next/server'
import { coachChatEnabledFor, photoRecognitionEnabled } from '@/lib/coach-chat/flags'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/coach/status -> { data: { enabled, photo_recognition } }
 * The app asks this once to decide whether to show the assistant at all. Not
 * signed in, kill switch on, or not granted: all simply "not enabled".
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ data: { enabled: false, photo_recognition: false } })
  const enabled = await coachChatEnabledFor(supabase)
  return NextResponse.json({ data: { enabled, photo_recognition: enabled && photoRecognitionEnabled() } })
}
