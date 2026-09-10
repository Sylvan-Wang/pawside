import { apiError } from '@/lib/api/response'
import { parseOnboardingInput } from '@/lib/contracts/onboarding'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Phase2OnboardingResult {
  profile: Record<string, unknown>
  capability_profile: Record<string, unknown>
  method: {
    status: 'active' | 'paused' | 'unavailable' | 'not_requested'
    reason: string | null
    enrollment_id?: string
    method_release_id?: string
    cycle_id?: string
    cycle_number?: number
    next_split_key?: 'push'
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return apiError('UNAUTHORIZED', '请先登录', 401)
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }

  const parsed = parseOnboardingInput(rawBody)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '请检查填写内容', 422, parsed.issues)
  }

  if (!parsed.data.capability_profile) {
    return apiError('VALIDATION_ERROR', '请完成轻量能力画像', 422)
  }

  const capability = parsed.data.capability_profile
  const { data, error } = await supabase.rpc('complete_phase2_onboarding', {
    p_goal: parsed.data.goal,
    p_gender: parsed.data.gender,
    p_height_cm: parsed.data.height_cm,
    p_reference_weight_kg: parsed.data.reference_weight_kg,
    p_weight_unit: parsed.data.weight_unit,
    p_training_experience: capability.training_experience,
    p_pushup_capacity: capability.pushup_capacity,
    p_equipment_access: capability.equipment_access,
    p_preferred_session_minutes: capability.preferred_session_minutes,
    p_join_method: parsed.data.join_method,
  })

  if (error || !data) {
    return apiError('DATABASE_ERROR', '暂时无法保存基础设置', 500)
  }

  const result = data as Phase2OnboardingResult
  const methodActive = result.method.status === 'active'
  return NextResponse.json(
    {
      data: result,
      message: methodActive
        ? '基础设置已保存，三分化已从「推」开始。'
        : '基础设置已保存。训练方法准备好后可单独启用。',
    },
    { status: 200 },
  )
}
