import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/response'
import { requireCoachUser } from '@/lib/coach-chat/http'
import { conversationBelongsTo, deleteConversation } from '@/lib/coach-chat/store'

/**
 * DELETE /api/coach/conversations/[id] - clears the chat (messages and cards).
 * Meals, workouts and weights that were saved from it are NOT touched: they are
 * ordinary records and are managed on their own pages.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireCoachUser()
  if (!gate.ok) return gate.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return apiError('VALIDATION_ERROR', '对话编号无效', 400)
  try {
    if (!(await conversationBelongsTo(gate.supabase, gate.user.id, id))) return apiError('NOT_FOUND', '对话不存在', 404)
    await deleteConversation(gate.supabase, gate.user.id, id)
    return NextResponse.json({ data: { deleted: true } })
  } catch {
    return apiError('DATABASE_ERROR', '暂时无法清空对话', 500)
  }
}
