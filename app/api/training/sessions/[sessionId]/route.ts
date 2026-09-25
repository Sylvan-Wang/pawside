import { apiError } from '@/lib/api/response'
import { buildWorkoutGuideMedia, type ExerciseMediaMapping } from '@/lib/exercise-media'
import { createClient } from '@/lib/supabase/server'
import { effectiveRequiredExerciseCount } from '@/lib/training-duration'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

interface RawExercise {
  canonical_name_zh: string
  media_mappings: ExerciseMediaMapping[] | null
}

interface RawSet {
  status?: string | null
  is_extra?: boolean | null
  [key: string]: unknown
}

interface RawExecution {
  id: string
  exercise: RawExercise | RawExercise[] | null
  prescription: unknown
  sets: RawSet[] | null
  [key: string]: unknown
}

/**
 * Minimum P1 §4.2 / §5: an exercise counts towards the Program Day threshold only
 * when every prescribed set of that exercise is completed. Extra sets performed
 * beyond the prescription never count against the user.
 *
 * This mirrors public.complete_method_session_v2 exactly. An exercise with no
 * prescribed set is vacuously satisfied, matching the SQL rule.
 */
function exerciseIsFullyCompleted(sets: RawSet[]) {
  const prescribed = sets.filter((set) => set.is_extra !== true)
  if (prescribed.length === 0) return true
  return prescribed.every((set) => set.status === 'completed')
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

  const [sessionResult, executionResult, profileResult] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select('id,session_prescription_id,enrollment_id,cycle_id,split_key,status,view_date,performed_at,performed_time_zone,log_date,execution_mode,duration_minutes,notes,started_at,completed_at,selected_session_minutes,selection_source,original_exercise_count,required_exercise_count,completion_policy_version,completed_exercise_count')
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
    supabase
      .from('user_profiles')
      .select('weight_unit')
      .eq('id', user.id)
      .maybeSingle(),
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
    const sets = execution.sets ?? []
    return {
      ...execution,
      exercise: exercise ? { canonical_name_zh: exercise.canonical_name_zh } : null,
      media: mapping ? buildWorkoutGuideMedia(mapping) : null,
      sets,
      fully_completed: exerciseIsFullyCompleted(sets),
    }
  })

  // Minimum P1 §13.2: the UI needs "how many exercises still count" without
  // re-deriving the policy. effectiveRequiredExerciseCount mirrors
  // public.complete_method_session_v2 exactly.
  const session = sessionResult.data
  const originalExerciseCount = session.original_exercise_count ?? executions.length
  const selectedSessionMinutes = session.selected_session_minutes ?? null
  const requiredExerciseCount = effectiveRequiredExerciseCount({
    executionMode: session.execution_mode,
    originalExerciseCount,
    snapshotRequiredExerciseCount: session.required_exercise_count,
    selectedSessionMinutes,
  })
  const completedExerciseCount = executions.filter((execution) => execution.fully_completed).length

  return NextResponse.json({
    data: {
      viewer_id: user.id,
      preferred_weight_unit: profileResult.data?.weight_unit === 'lb' ? 'lb' : 'kg',
      session,
      exercises: executions,
      progress: {
        original_exercise_count: originalExerciseCount,
        required_exercise_count: requiredExerciseCount,
        completed_exercise_count: completedExerciseCount,
        selected_session_minutes: selectedSessionMinutes,
        selection_source: session.selection_source ?? null,
        completion_policy_version: session.completion_policy_version ?? null,
        can_complete: session.status === 'started'
          && completedExerciseCount >= requiredExerciseCount,
        program_day_completed: session.status === 'completed',
      },
    },
  })
}
