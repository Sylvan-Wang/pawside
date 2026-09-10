import { apiError } from '@/lib/api/response'
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

  const { data: release, error: releaseError } = await supabase
    .from('method_releases')
    .select('id,version,status,release_channel,method:methods(id,key,name,description)')
    .eq('status', 'active')
    .eq('runtime_gate_status', 'passed')
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (releaseError) {
    return apiError('DATABASE_ERROR', '暂时无法读取训练方法发布状态', 500)
  }

  if (release) {
    return NextResponse.json({
      data: null,
      availability: {
        status: 'available',
        reason: 'NOT_ENROLLED',
        message: '三分化已经准备好，完成能力画像后即可从「推」开始。',
        release,
      },
    })
  }

  return NextResponse.json({
    data: null,
    availability: {
      status: 'unavailable',
      reason: 'METHOD_NOT_READY',
      message: '官方训练方法仍在发布校验中，基础设置和自由训练不受影响。',
    },
  })
}
