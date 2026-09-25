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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TODAY_PRESCRIPTION_SELECT = `
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
    id,exercise_id,order_index,method_role,progression_stage_key,
    target_summary_zh,target_weight_kg,weight_guidance_type,status,
    exercise:exercises(
      canonical_name_zh,
      media_mappings:exercise_external_mappings(
        provider,external_slug,source_version,license,attribution,
        source_url,mapping_status,mapping_notes
      )
    ),
    sets:set_prescriptions(*)
  )
`

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function dateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const url = new URL(request.url)
  const requestedTimeZone = url.searchParams.get('time_zone') || 'UTC'
  if (!isTimeZone(requestedTimeZone)) return apiError('VALIDATION_ERROR', '用户时区无效', 400)
  const currentLogDate = dateInTimeZone(requestedTimeZone)
  const requestedDate = url.searchParams.get('date') || currentLogDate
  if (!DATE_PATTERN.test(requestedDate)) return apiError('VALIDATION_ERROR', '训练日期无效', 400)

  let activeQuery = supabase
    .from('workout_sessions')
    .select('id,session_prescription_id,status,started_at,completed_at,view_date,log_date,execution_mode')
    .eq('user_id', user.id)
    .eq('status', 'started')
  if (requestedDate !== currentLogDate) activeQuery = activeQuery.eq('view_date', requestedDate)
  const { data: activeSession, error: activeSessionError } = await activeQuery
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (activeSessionError) return apiError('DATABASE_ERROR', '暂时无法恢复当前训练', 500)

  const effectiveViewDate = activeSession?.view_date || requestedDate
  let prescriptionResult = activeSession
    ? await supabase
        .from('session_prescriptions')
        .select(TODAY_PRESCRIPTION_SELECT)
        .eq('user_id', user.id)
        .eq('id', activeSession.session_prescription_id)
        .maybeSingle()
    : await supabase
        .from('session_prescriptions')
        .select(TODAY_PRESCRIPTION_SELECT)
        .eq('user_id', user.id)
        .eq('planned_for_date', effectiveViewDate)
        .neq('status', 'cancelled')
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

  if (!activeSession && !prescriptionResult.data && effectiveViewDate === currentLogDate) {
    prescriptionResult = await supabase
      .from('session_prescriptions')
      .select(TODAY_PRESCRIPTION_SELECT)
      .eq('user_id', user.id)
      .in('status', ['ready', 'started', 'rest_deferred', 'upcoming'])
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  }

  const { data: prescription, error } = prescriptionResult
  if (error) return apiError('DATABASE_ERROR', '暂时无法读取所选日期的训练要求', 500)
  if (!prescription) return apiError('NOT_FOUND', '所选日期没有训练计划', 404)

  const rawExercises = (prescription.exercises ?? []) as unknown as RawExercisePrescription[]
  const exercises = rawExercises.map((item) => {
    const exercise = Array.isArray(item.exercise) ? item.exercise[0] : item.exercise
    const mapping = exercise?.media_mappings?.find(
      (candidate) => candidate.provider === '@bryllim/workout-guide' && candidate.mapping_status !== 'rejected',
    )
    return {
      ...item,
      exercise: exercise ? { canonical_name_zh: exercise.canonical_name_zh } : null,
      media: mapping ? buildWorkoutGuideMedia(mapping) : null,
    }
  })

  return NextResponse.json({
    data: {
      view_date: effectiveViewDate,
      current_log_date: currentLogDate,
      recovery: activeSession ? { kind: 'active_session', session_id: activeSession.id } : null,
      prescription: { ...prescription, exercises },
      workout_actual: activeSession,
    },
  })
}
