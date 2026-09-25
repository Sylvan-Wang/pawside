import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { startTrainingSessionSchema } from '@/lib/contracts/training-runtime'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params
  if (!idSchema.safeParse(prescriptionId).success) {
    return apiError('VALIDATION_ERROR', '训练处方编号无效', 400)
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
  const parsed = startTrainingSessionSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', '训练日期或时区无效', 400, parsed.error.flatten())

  // Minimum P1 §8: the server re-validates the duration and falls back to the
  // onboarding preference (then 60) inside start_method_session_v2 when omitted.
  const { data, error } = await supabase.rpc('start_method_session_v2', {
    p_prescription_id: prescriptionId,
    p_view_date: parsed.data.view_date,
    p_time_zone: parsed.data.time_zone,
    p_start_request_id: parsed.data.start_request_id,
    p_selected_session_minutes: parsed.data.selected_session_minutes ?? null,
    p_selection_source: parsed.data.selection_source ?? null,
  })
  if (error) return trainingDatabaseError(error)

  return NextResponse.json({ data })
}
