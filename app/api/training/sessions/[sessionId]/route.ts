import { apiError } from '@/lib/api/response'
import { buildWorkoutGuideMedia, type ExerciseMediaMapping } from '@/lib/exercise-media'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

interface RawExercise {
  canonical_name_zh: string
  media_mappings: ExerciseMediaMapping[] | null
}

interface RawExecution {
  id: string
  exercise: RawExercise | RawExercise[] | null
  prescription: unknown
  sets: unknown[] | null
  [key: string]: unknown
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  if (!idSchema.safeParse(sessionId).success) {
    return apiError('VALIDATION_ERROR', '训练编号无效', 400)
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const [sessionResult, executionResult] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select('id,session_prescription_id,enrollment_id,cycle_id,split_key,status,log_date,duration_minutes,notes,started_at,completed_at')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('exercise_executions')
      .select(`
        id,
        exercise_prescription_id,
        order_index,
        status,
        exercise:exercises(
          canonical_name_zh,
          media_mappings:exercise_external_mappings(
            provider,external_slug,source_version,license,attribution,
            source_url,mapping_status,mapping_notes
          )
        ),
        prescription:exercise_prescriptions(
          target_summary_zh,
          target_weight_kg,
          weight_guidance_type,
          sets:set_prescriptions(*)
        ),
        sets:set_executions(
          id,set_prescription_id,set_index,actual_weight_kg,actual_reps,
          actual_rir,status,is_extra,completed_at
        )
      `)
      .eq('workout_session_id', sessionId)
      .eq('user_id', user.id)
      .order('order_index'),
  ])

  if (sessionResult.error || executionResult.error) {
    return apiError('DATABASE_ERROR', '暂时无法读取训练记录', 500)
  }
  if (!sessionResult.data) return apiError('NOT_FOUND', '训练记录不存在', 404)

  const executions = ((executionResult.data ?? []) as unknown as RawExecution[]).map((execution) => {
    const exercise = Array.isArray(execution.exercise) ? execution.exercise[0] : execution.exercise
    const mapping = exercise?.media_mappings?.find(
      (candidate) => candidate.provider === '@bryllim/workout-guide' && candidate.mapping_status !== 'rejected',
    )
    return {
      ...execution,
      exercise: exercise ? { canonical_name_zh: exercise.canonical_name_zh } : null,
      media: mapping ? buildWorkoutGuideMedia(mapping) : null,
      sets: execution.sets ?? [],
    }
  })

  return NextResponse.json({ data: { session: sessionResult.data, exercises: executions } })
}
