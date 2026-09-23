import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data: enrollment, error: enrollmentError } = await supabase
    .from('method_enrollments')
    .select('id,method_release_id,current_cycle_number,next_split_key,current_state')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (enrollmentError) return apiError('DATABASE_ERROR', '暂时无法读取训练进度', 500)
  if (!enrollment) return apiError('NOT_ENROLLED', '尚未启用训练方法', 404)

  const [cycleResult, progressionResult] = await Promise.all([
    supabase
      .from('method_cycles')
      .select('id,cycle_number,started_at,completed_at,push_session_id,pull_session_id,legs_session_id,status')
      .eq('enrollment_id', enrollment.id)
      .eq('cycle_number', enrollment.current_cycle_number)
      .maybeSingle(),
    supabase
      .from('user_exercise_progression')
      .select(`
        exercise_id,
        progression_rule_key,
        current_stage_key,
        current_reference_weight_kg,
        stage_started_at,
        last_evaluated_at,
        status,
        exercise:exercises(canonical_name_zh)
      `)
      .eq('enrollment_id', enrollment.id)
      .order('created_at'),
  ])

  if (cycleResult.error || progressionResult.error) {
    return apiError('DATABASE_ERROR', '暂时无法读取训练进度', 500)
  }

  return NextResponse.json({
    data: {
      enrollment,
      cycle: cycleResult.data,
      exercise_progression: progressionResult.data ?? [],
    },
  })
}
