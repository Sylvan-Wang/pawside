import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/response'
import { requireCoachUser } from '@/lib/coach-chat/http'
import { conversationBelongsTo, listMessages } from '@/lib/coach-chat/store'
import { toMessageViews } from '@/lib/coach-chat/views'

/**
 * GET /api/coach/conversations/[id]/messages?before=<ISO>&limit=30&time_zone=...
 * The user's own history, oldest first within the page. `before` pages backwards.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireCoachUser()
  if (!gate.ok) return gate.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return apiError('VALIDATION_ERROR', '对话编号无效', 400)

  const params = request.nextUrl.searchParams
  const before = params.get('before')
  if (before && Number.isNaN(Date.parse(before))) return apiError('VALIDATION_ERROR', 'before 无效', 400)
  const limit = Number(params.get('limit') ?? '30')

  try {
    if (!(await conversationBelongsTo(gate.supabase, gate.user.id, id))) return apiError('NOT_FOUND', '对话不存在', 404)
    const rows = await listMessages(gate.supabase, gate.user.id, id, { before, limit: Number.isFinite(limit) ? limit : 30 })
    const messages = await toMessageViews(gate.supabase, gate.user.id, rows, params.get('time_zone'))
    return NextResponse.json({ data: { messages, has_more: rows.length >= Math.min(Math.max(limit || 30, 1), 100) } })
  } catch (reason) {
    console.error('[coach-chat] load messages failed', reason instanceof Error ? reason.message : reason)
    return apiError('DATABASE_ERROR', '暂时无法读取对话记录', 500)
  }
}
