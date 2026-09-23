import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { saveSetActualSchema } from '@/lib/contracts/training-runtime'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

export async function PUT(
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

  const parsed = saveSetActualSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '请检查重量、次数和剩余次数', 400, parsed.error.flatten())
  }

  const input = parsed.data
  const { data, error } = await supabase.rpc('save_method_set_actual', {
    p_session_id: sessionId,
    p_exercise_execution_id: input.exercise_execution_id,
    p_set_index: input.set_index,
    p_actual_weight_kg: input.actual_weight_kg ?? null,
    p_actual_reps: input.actual_reps,
    p_actual_rir: input.actual_rir ?? null,
  })
  if (error) return trainingDatabaseError(error)

  return NextResponse.json({ data })
}
