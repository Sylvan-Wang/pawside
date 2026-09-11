import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { completeTrainingSessionSchema } from '@/lib/contracts/training-runtime'
import { createClient } from '@/lib/supabase/server'
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

  const { data, error } = await supabase.rpc('complete_method_session', {
    p_session_id: sessionId,
    p_duration_minutes: parsed.data.duration_minutes ?? null,
    p_notes: parsed.data.notes ?? null,
  })
  if (error) return trainingDatabaseError(error)

  return NextResponse.json({ data })
}
