import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { completeTrainingSessionSchema } from '@/lib/contracts/training-runtime'
import { createClient } from '@/lib/supabase/server'
import { invalidateDayDerivedCache } from '@/lib/utils'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  if (!idSchema.safeParse(sessionId).success) {
    return apiError('VALIDATION_ERROR', '训练编号无效', 400)
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let body: unknown = {}
  try {
    const raw = await request.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }

  const parsed = completeTrainingSessionSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '训练完成信息无效', 400, parsed.error.flatten())
  }

  // Minimum P1 §9: completion runs on complete_method_session_v2
  // (exercise_count_threshold_v1). The legacy complete_method_session is left
  // untouched for the released caller.
  const { data, error } = await supabase.rpc('complete_method_session_v2', {
    p_session_id: sessionId,
    p_completion_request_id: parsed.data.completion_request_id,
    p_duration_minutes: parsed.data.duration_minutes ?? null,
    p_notes: parsed.data.notes ?? null,
  })
  if (error) return trainingDatabaseError(error)

  const result = data as Record<string, unknown> & { log_date?: string } | null
  const { data: workoutLog, error: workoutLogError } = await supabase
    .from('workout_logs')
    .select('id')
    .eq('user_id', user.id)
    .eq('method_workout_session_id', sessionId)
    .maybeSingle()
  if (workoutLogError) return trainingDatabaseError(workoutLogError)

  const invalidation = result?.log_date
    ? await invalidateDayDerivedCache(supabase, user.id, result.log_date)
    : { ok: false, error: 'completion did not return log_date' }

  return NextResponse.json({
    data: result ? { ...result, workout_log_id: workoutLog?.id ?? null } : null,
    cache_invalidation: invalidation,
  })
}
