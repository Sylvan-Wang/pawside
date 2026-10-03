import { apiError } from '@/lib/api/response'
import { methodAvailabilityMessage, type MethodAvailabilityReason } from '@/lib/method-availability'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface EnrollmentResult {
  status: 'active' | 'paused' | 'unavailable'
  reason: string | null
  enrollment_id?: string
  method_release_id?: string
  cycle_id?: string
  cycle_number?: number
  next_split_key?: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return apiError('UNAUTHORIZED', '请先登录', 401)
  }

  let releaseId: string | null = null
  try {
    const body = await request.json() as { release_id?: unknown }
    releaseId = typeof body.release_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.release_id)
      ? body.release_id
      : null
  } catch {
    // Existing callers send no body and keep the official 1.2 path.
  }

  const { data, error } = releaseId
    ? await supabase.rpc('enroll_in_method_release_v1', { p_release_id: releaseId })
    : await supabase.rpc('initialize_current_method_enrollment')
  if (error || !data) {
    return apiError('DATABASE_ERROR', '暂时无法启用训练方法', 500)
  }

  const result = data as EnrollmentResult
  if (result.status === 'unavailable') {
    const reason = (result.reason || 'METHOD_NOT_READY') as Exclude<MethodAvailabilityReason, 'NOT_ENROLLED'>
    return apiError(reason, methodAvailabilityMessage(reason), 409)
  }

  return NextResponse.json({
    data: result,
    message: result.status === 'paused'
      ? '当前训练方法处于暂停状态。'
      : '训练方法已启用。',
  })
}
