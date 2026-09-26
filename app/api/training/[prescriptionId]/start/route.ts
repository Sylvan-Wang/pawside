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

  // v3 serializes starts per user and returns the existing active session when
  // another Program Day is already in progress. The v2 writer remains the
  // implementation of the immutable prescription snapshot.
  const { data, error } = await supabase.rpc('start_method_session_v3', {
    p_prescription_id: prescriptionId,
    p_view_date: parsed.data.view_date,
    p_time_zone: parsed.data.time_zone,
    p_start_request_id: parsed.data.start_request_id,
    p_selected_session_minutes: parsed.data.selected_session_minutes ?? null,
    p_selection_source: parsed.data.selection_source ?? null,
  })
  if (error) return trainingDatabaseError(error)
  const result = data as {
    active_session_conflict?: boolean
    active_session_id?: string
    active_split_key?: string
  } | null
  if (result?.active_session_conflict) {
    return apiError('CONFLICT', '已有未完成训练，请先继续当前训练', 409, {
      session_id: result.active_session_id,
      split_key: result.active_split_key,
    })
  }

  return NextResponse.json({ data })
}
