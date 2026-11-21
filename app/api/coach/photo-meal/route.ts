import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logGeneration } from '@/lib/ai/generation-log'
import { callStructuredOutput, getChatModel } from '@/lib/ai-client'
import { apiError } from '@/lib/api/response'
import { coachChatFeatures, photoRecognitionEnabled } from '@/lib/coach-chat/flags'
import { requireCoachUser } from '@/lib/coach-chat/http'
import { handlePhotoMeal, PhotoMealError } from '@/lib/coach-chat/photo-meal'
import { makePhotoRecognizer, MAX_PHOTOS_PER_MEAL } from '@/lib/coach-chat/photo-recognize'
import { createEstimator } from '@/lib/coach-chat/planner'
import { TEXT } from '@/lib/coach-chat/replies'
import { countUserMessagesSince, describeError } from '@/lib/coach-chat/store'
import { toMessageViews } from '@/lib/coach-chat/views'

/**
 * POST /api/coach/photo-meal
 *   { conversation_id, client_message_id, photo_ids: [1..3], time_zone }
 *
 * The user tapped 「识别这一餐」 on meal photos they sent in the chat. The photos
 * go to the model; the answer is a meal card to confirm, never a saved record.
 * Off unless PAWSIDE_PHOTO_RECOGNITION is on.
 */

const DAILY_MESSAGE_LIMIT = 300
const PHOTO_TIMEOUT_MS = 30_000

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  client_message_id: z.string().uuid(),
  photo_ids: z.array(z.string().uuid()).min(1).max(MAX_PHOTOS_PER_MEAL),
  time_zone: z.string().trim().min(1).max(100),
})

export async function POST(request: NextRequest) {
  const gate = await requireCoachUser()
  if (!gate.ok) return gate.response
  if (!photoRecognitionEnabled()) return apiError('FEATURE_DISABLED', '照片识别还没开放', 403)
  const { supabase, user } = gate

  let raw: unknown
  try { raw = await request.json() } catch { return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400) }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请检查请求内容', 422, parsed.error.flatten())
  const body = parsed.data

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  if (await countUserMessagesSince(supabase, user.id, since) >= DAILY_MESSAGE_LIMIT) {
    return apiError('RATE_LIMITED', TEXT.rateLimited, 429)
  }

  try {
    const result = await handlePhotoMeal(
      {
        supabase,
        userId: user.id,
        recognizer: makePhotoRecognizer(callStructuredOutput, { model: getChatModel(), timeoutMs: PHOTO_TIMEOUT_MS }),
        estimator: createEstimator(),
        log: logGeneration,
        mealsEnabled: coachChatFeatures().meals,
      },
      {
        conversationId: body.conversation_id,
        clientMessageId: body.client_message_id,
        photoIds: body.photo_ids,
        timeZone: body.time_zone,
      },
    )
    const [userMessage, assistantMessage] = await toMessageViews(
      supabase, user.id, [result.userMessage, result.assistantMessage], body.time_zone,
    )
    return NextResponse.json({ data: { duplicate: result.duplicate, user_message: userMessage, assistant_message: assistantMessage } })
  } catch (reason) {
    if (reason instanceof PhotoMealError) {
      switch (reason.code) {
        case 'conversation_not_found': return apiError('NOT_FOUND', reason.message, 404)
        case 'in_progress': return apiError('CONFLICT', reason.message, 409)
        default: return apiError('VALIDATION_ERROR', reason.message, 422)
      }
    }
    console.error('[coach-chat] photo meal failed', describeError(reason))
    return apiError('DATABASE_ERROR', '暂时无法识别这张照片，请稍后再试', 500)
  }
}
