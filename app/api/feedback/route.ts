import { apiError } from '@/lib/api/response'
import {
  canAcceptRating,
  loadFeedback,
  upsertFeedback,
  type FeedbackContentType,
  type FeedbackScope,
} from '@/lib/feedback'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * /api/feedback — scoped 👍/👎 with provenance (Product Patch §14, AI Patch §32)
 *
 * GET  ?content_type=&scope_id=   -> current rating for one rated entity
 * POST { content_type, scope, scope_id, rating, prompt_version, model,
 *        input_snapshot_id, output_json? }
 *
 * Product §14 gate: a rating is refused unless the provenance needed to
 * interpret it is supplied. Without prompt_version + model + input_snapshot_id
 * the rating would be an un-actionable button, which §14 explicitly rejects.
 */

const contentTypeSchema = z.enum([
  'workout_session_feedback',
  'meal_feedback',
  'daily_review',
  'weekly_review',
])

const scopeSchema = z.enum(['session', 'meal', 'day', 'week'])

const bodySchema = z.object({
  content_type: contentTypeSchema,
  scope: scopeSchema,
  scope_id: z.string().min(1),
  rating: z.enum(['liked', 'disliked']).nullable(),
  prompt_version: z.string().min(1),
  model: z.string().min(1),
  model_version: z.string().nullable().optional(),
  input_snapshot_id: z.string().min(1),
  evidence_registry_version: z.string().nullable().optional(),
  output_json: z.unknown().optional(),
})

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const contentType = request.nextUrl.searchParams.get('content_type')
  const scopeId = request.nextUrl.searchParams.get('scope_id')
  const parsedContentType = contentTypeSchema.safeParse(contentType)
  if (!parsedContentType.success || !scopeId) {
    return apiError('VALIDATION_ERROR', '缺少 content_type 或 scope_id', 400)
  }

  try {
    const record = await loadFeedback(
      supabase,
      user.id,
      parsedContentType.data,
      scopeId,
    )
    return NextResponse.json({ data: record })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法读取反馈',
      500,
    )
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '请检查反馈内容', 422, parsed.error.flatten())
  }

  // Product §14: refuse the rating when provenance is incomplete, and say what
  // is missing instead of silently storing a bare boolean.
  const gate = canAcceptRating(parsed.data)
  if (!gate.allowed && parsed.data.rating !== null) {
    return apiError(
      'VALIDATION_ERROR',
      `反馈缺少可追溯信息：${gate.missing.join(', ')}`,
      422,
    )
  }

  try {
    await upsertFeedback(supabase, {
      userId: user.id,
      contentType: parsed.data.content_type as FeedbackContentType,
      scope: parsed.data.scope as FeedbackScope,
      scopeId: parsed.data.scope_id,
      rating: parsed.data.rating,
      inputSnapshotId: parsed.data.input_snapshot_id,
      promptVersion: parsed.data.prompt_version,
      model: parsed.data.model,
      modelVersion: parsed.data.model_version ?? null,
      evidenceRegistryVersion: parsed.data.evidence_registry_version ?? null,
      outputJson: parsed.data.output_json ?? null,
    })
    return NextResponse.json({ data: { saved: true, rating: parsed.data.rating } })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法保存反馈',
      500,
    )
  }
}
