import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logGeneration } from '@/lib/ai/generation-log'
import { apiError } from '@/lib/api/response'
import { coachChatFeatures } from '@/lib/coach-chat/flags'
import { requireCoachUser } from '@/lib/coach-chat/http'
import { handleChatTurn, MAX_MESSAGE_CHARS, TurnError } from '@/lib/coach-chat/orchestrator'
import { createEstimator, createPlanner } from '@/lib/coach-chat/planner'
import { TEXT } from '@/lib/coach-chat/replies'
import { countUserMessagesSince } from '@/lib/coach-chat/store'
import { toMessageViews } from '@/lib/coach-chat/views'

/**
 * POST /api/coach/chat
 *   { conversation_id, client_message_id, text, time_zone, answer?: { draft_id, option_index } }
 *
 * One chat turn. It can create cards (drafts); it never saves a record. The
 * client_message_id makes a retried send return the first answer. A model
 * failure is a normal 200 with an apology and no card, not an error: the user's
 * message is kept and the manual pages are unaffected.
 */

const DAILY_MESSAGE_LIMIT = 300

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  client_message_id: z.string().uuid(),
  text: z.string().min(1).max(MAX_MESSAGE_CHARS * 2),
  time_zone: z.string().trim().min(1).max(100),
  answer: z.object({
    draft_id: z.string().uuid(),
    option_index: z.number().int().min(0).max(3),
  }).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const gate = await requireCoachUser()
  if (!gate.ok) return gate.response
  const { supabase, user } = gate

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请检查请求内容', 422, parsed.error.flatten())
  const body = parsed.data

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  if (await countUserMessagesSince(supabase, user.id, since) >= DAILY_MESSAGE_LIMIT) {
    return apiError('RATE_LIMITED', TEXT.rateLimited, 429)
  }

  try {
    const result = await handleChatTurn(
      {
        supabase,
        userId: user.id,
        planner: createPlanner(),
        estimator: createEstimator(),
        log: logGeneration,
        features: coachChatFeatures(),
      },
      {
        conversationId: body.conversation_id,
        clientMessageId: body.client_message_id,
        text: body.text,
        timeZone: body.time_zone,
        answer: body.answer ? { draftId: body.answer.draft_id, optionIndex: body.answer.option_index } : null,
      },
    )
    const [userMessage, assistantMessage] = await toMessageViews(
      supabase, user.id, [result.userMessage, result.assistantMessage], body.time_zone,
    )
    return NextResponse.json({ data: { duplicate: result.duplicate, user_message: userMessage, assistant_message: assistantMessage } })
  } catch (reason) {
    if (reason instanceof TurnError) {
      switch (reason.code) {
        case 'conversation_not_found': return apiError('NOT_FOUND', reason.message, 404)
        case 'bad_answer': return apiError('CONFLICT', reason.message, 409)
        default: return apiError('VALIDATION_ERROR', reason.message, 422)
      }
    }
    console.error('[coach-chat] turn failed', reason instanceof Error ? reason.message : reason)
    return apiError('DATABASE_ERROR', '暂时无法处理这条消息，请稍后再试', 500)
  }
}
