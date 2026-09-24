import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { trainingExerciseActionSchema } from '@/lib/contracts/training-exercise-action'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; executionId: string }> },
) {
  const { sessionId, executionId } = await params
  if (!idSchema.safeParse(sessionId).success || !idSchema.safeParse(executionId).success) {
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

  const parsed = trainingExerciseActionSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', '动作状态无效', 400, parsed.error.flatten())

  const { data, error } = await supabase.rpc('set_method_exercise_status', {
    p_session_id: sessionId,
    p_exercise_execution_id: executionId,
    p_action: parsed.data.action,
  })
  if (error) return trainingDatabaseError(error)

  return NextResponse.json({ data })
}
