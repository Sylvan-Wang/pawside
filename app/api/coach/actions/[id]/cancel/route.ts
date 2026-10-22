import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/response'
import { buildCard } from '@/lib/coach-chat/cards'
import { cancelDraft } from '@/lib/coach-chat/commit'
import { validTimeZone } from '@/lib/coach-chat/dates'
import { requireCoachUser } from '@/lib/coach-chat/http'
import { dateKeyInTimeZone } from '@/lib/utils'

/** POST /api/coach/actions/[id]/cancel  { time_zone } - drops a card that is still waiting. Nothing is written. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireCoachUser()
  if (!gate.ok) return gate.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return apiError('VALIDATION_ERROR', '卡片编号无效', 400)

  const body = await request.json().catch(() => null) as { time_zone?: unknown } | null
  const timeZone = validTimeZone(body?.time_zone)
  if (!timeZone) return apiError('VALIDATION_ERROR', '请检查请求内容', 422)

  try {
    const result = await cancelDraft({ supabase: gate.supabase, userId: gate.user.id, draftId: id })
    if (result.status === 'not_found' || !result.draft) return apiError('NOT_FOUND', '没找到这张卡片', 404)
    const now = new Date()
    return NextResponse.json({
      data: {
        status: result.status,
        text: result.status === 'cancelled' ? '好，这条不记了。' : '这张卡片现在不能取消，请看看它的状态。',
        card: buildCard(result.draft, now, dateKeyInTimeZone(now, timeZone)),
      },
    })
  } catch (reason) {
    console.error('[coach-chat] cancel failed', reason instanceof Error ? reason.message : reason)
    return apiError('DATABASE_ERROR', '暂时无法取消，请稍后再试', 500)
  }
}
