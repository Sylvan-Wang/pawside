import { apiError } from '@/lib/api/response'
import { buildWorkoutGuideMedia, type ExerciseMediaMapping } from '@/lib/exercise-media'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface RawExerciseRecord {
  canonical_name_zh: string
  media_mappings: ExerciseMediaMapping[] | null
}

interface RawExercisePrescription {
  exercise: RawExerciseRecord | RawExerciseRecord[] | null
  [key: string]: unknown
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data: prescription, error } = await supabase
    .from('session_prescriptions')
    .select(`
      id,
      enrollment_id,
      cycle_id,
      split_key,
      planned_for_date,
      status,
      generated_from_rule_version,
      generated_at,
      started_at,
      completed_at,
      method_split:method_splits(id,name_zh,order_index),
      exercises:exercise_prescriptions(
        id,
        exercise_id,
        order_index,
        method_role,
        progression_stage_key,
        target_summary_zh,
        target_weight_kg,
        weight_guidance_type,
        status,
        exercise:exercises(
          canonical_name_zh,
          media_mappings:exercise_external_mappings(
            provider,
            external_slug,
            source_version,
            license,
            attribution,
            source_url,
            mapping_status,
            mapping_notes
          )
        ),
        sets:set_prescriptions(*)
      )
    `)
    .eq('user_id', user.id)
    .in('status', ['ready', 'started', 'rest_deferred', 'upcoming'])
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return apiError('DATABASE_ERROR', '暂时无法读取今日训练要求', 500)
  if (!prescription) return apiError('NOT_FOUND', '当前没有可执行的训练要求', 404)

  const rawExercises = (prescription.exercises ?? []) as unknown as RawExercisePrescription[]
  const exercises = rawExercises.map((item) => {
    const exercise = Array.isArray(item.exercise) ? item.exercise[0] : item.exercise
    const mapping = exercise?.media_mappings?.find(
      (candidate) => candidate.provider === '@bryllim/workout-guide' && candidate.mapping_status !== 'rejected'
    )

    return {
      ...item,
      exercise: exercise ? { canonical_name_zh: exercise.canonical_name_zh } : null,
      media: mapping ? buildWorkoutGuideMedia(mapping) : null,
    }
  })

  return NextResponse.json({
    data: {
      recovery: null,
      prescription: { ...prescription, exercises },
      workout_actual: null,
    },
  })
}
