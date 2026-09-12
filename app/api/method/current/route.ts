import { apiError } from '@/lib/api/response'
import { evaluateMethodAvailability } from '@/lib/method-availability'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data: enrollment, error: enrollmentError } = await supabase
    .from('method_enrollments')
    .select('id,status,started_at,current_cycle_number,next_split_key,current_state,method_release_id,method:methods(id,key,name,version,status,description),method_release:method_releases(id,version,status,release_channel)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (enrollmentError) {
    return apiError('DATABASE_ERROR', '暂时无法读取当前训练方法', 500)
  }

  if (enrollment) {
    return NextResponse.json({
      data: enrollment,
      availability: {
        status: 'active',
        reason: null,
        message: null,
      },
    })
  }

  const [profileResult, capabilityResult, releaseResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('onboarding_capability_profiles')
      .select('equipment_access')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('method_releases')
      .select('id,version,status,release_channel,method:methods(id,key,name,description)')
      .eq('status', 'active')
      .eq('runtime_gate_status', 'passed')
      .order('activated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (profileResult.error || capabilityResult.error || releaseResult.error) {
    return apiError('DATABASE_ERROR', '暂时无法读取训练方法资格状态', 500)
  }

  const release = releaseResult.data
  const availability = evaluateMethodAvailability({
    onboardingCompleted: profileResult.data?.onboarding_completed === true,
    capabilityProfileExists: capabilityResult.data !== null,
    equipmentAccess: capabilityResult.data?.equipment_access ?? null,
    releaseAvailable: release !== null,
  })

  if (availability.status === 'available' && release) {
    return NextResponse.json({
      data: null,
      availability: {
        ...availability,
        release,
      },
    })
  }

  return NextResponse.json({
    data: null,
    availability,
  })
}
