import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { requireCoachUser } from '@/lib/coach-chat/http'
import { describeError, getOrCreateConversation } from '@/lib/coach-chat/store'

/** POST /api/coach/conversations -> { data: { conversation_id } }  (the user's current conversation, created on first use) */
export async function POST() {
  const gate = await requireCoachUser()
  if (!gate.ok) return gate.response
  try {
    return NextResponse.json({ data: { conversation_id: await getOrCreateConversation(gate.supabase, gate.user.id) } })
  } catch (reason) {
    console.error('[coach-chat] open conversation failed', describeError(reason))
    return apiError('DATABASE_ERROR', '暂时无法打开对话', 500)
  }
}
