import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface EnrollmentResult {
  status: 'active' | 'paused' | 'unavailable'
  reason: string | null
  enrollment_id?: string
  method_release_id?: string
  cycle_id?: string
  cycle_number?: number
  next_split_key?: 'push'
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return apiError('UNAUTHORIZED', '请先登录', 401)
  }

  const { data, error } = await supabase.rpc('initialize_current_method_enrollment')
  if (error || !data) {
    return apiError('DATABASE_ERROR', '暂时无法启用训练方法', 500)
  }

  const result = data as EnrollmentResult
  if (result.status === 'unavailable') {
    const message = result.reason === 'ONBOARDING_INCOMPLETE'
      ? '请先完成基础设置'
      : result.reason === 'CAPABILITY_PROFILE_MISSING'
        ? '请先完成轻量能力画像'
        : result.reason === 'EQUIPMENT_REVIEW_REQUIRED'
          ? '当前三分化需要完整健身房器械，暂不自动创建训练计划'
        : '训练方法仍在发布校验中'
    return apiError(
      result.reason === 'METHOD_NOT_READY' ? 'METHOD_NOT_READY' : 'ONBOARDING_INCOMPLETE',
      message,
      409,
    )
  }

  return NextResponse.json({
    data: result,
    message: result.status === 'paused'
      ? '三分化目前处于暂停状态。'
      : '三分化已启用，第一项从「推」开始。',
  })
}
