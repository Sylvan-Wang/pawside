import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { updateTrainingDurationSchema } from '@/lib/contracts/training-runtime'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

/**
 * Minimum P1 §7: shorten (or lengthen) the duration of an ACTIVE session.
 * Saved set actuals are never discarded, the session is never recreated, the
 * Method prescription is never rewritten, and the long-term onboarding
 * preferred_session_minutes is never modified.
 */
export async function PATCH(
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }

  const parsed = updateTrainingDurationSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '训练时长无效', 400, parsed.error.flatten())
  }

  const { data, error } = await supabase.rpc('update_method_session_duration', {
    p_session_id: sessionId,
    p_selected_session_minutes: parsed.data.selected_session_minutes,
    p_selection_source: parsed.data.selection_source,
  })
  if (error) return trainingDatabaseError(error)

  return NextResponse.json({ data })
}
