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

interface PrescriptionRow {
  id: string
  split_key: string
  status: string
  planned_for_date: string | null
  cycle_id: string | null
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const PROGRAM_DAY_ORDER = ['push', 'pull', 'legs'] as const
type ProgramDaySplit = (typeof PROGRAM_DAY_ORDER)[number]

const PROGRAM_DAY_FALLBACK_NAMES: Record<ProgramDaySplit, string> = {
  push: '推',
  pull: '拉',
  legs: '腿',
}

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

function isProgramDaySplit(value: string | null): value is ProgramDaySplit {
  return value != null && (PROGRAM_DAY_ORDER as readonly string[]).includes(value)
}

/**
 * Minimum P1 §1 / §2: the training page is Program Day navigation.
 *
 * - Program Day identity is (cycle_number, split_key).
 * - `date` is only a context/history value; it no longer selects the plan and it
 *   is never used to decide canonical/replay.
 * - Resolving a Program Day may idempotently materialise that Day's prescription
 *   (PRD §2.3). That is a pure materialisation: it never advances
 *   next_split_key, cycle status, or Program Day completion.
 * - Viewing never starts or completes anything.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const url = new URL(request.url)
  const requestedTimeZone = url.searchParams.get('time_zone') || 'UTC'
  if (!isTimeZone(requestedTimeZone)) return apiError('VALIDATION_ERROR', '用户时区无效', 400)
  const currentLogDate = dateInTimeZone(requestedTimeZone)

  const requestedSplitParam = url.searchParams.get('split')
  if (requestedSplitParam != null && !isProgramDaySplit(requestedSplitParam)) {
    return apiError('VALIDATION_ERROR', '训练日无效', 400)
  }
  const requestedSplit = isProgramDaySplit(requestedSplitParam) ? requestedSplitParam : null

  const requestedDate = url.searchParams.get('date') || currentLogDate
  if (!DATE_PATTERN.test(requestedDate)) return apiError('VALIDATION_ERROR', '训练日期无效', 400)

  const { data: enrollment, error: enrollmentError } = await supabase
    .from('method_enrollments')
    .select('id,status,current_cycle_number,next_split_key,current_state')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (enrollmentError) return apiError('DATABASE_ERROR', '暂时无法读取训练进度', 500)

  // Program Day identity for a started session comes from the session itself.
  const { data: activeSession, error: activeSessionError } = await supabase
    .from('workout_sessions')
    .select('id,session_prescription_id,status,started_at,completed_at,view_date,log_date,execution_mode,split_key,selected_session_minutes,required_exercise_count')
    .eq('user_id', user.id)
    .eq('status', 'started')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (activeSessionError) return apiError('DATABASE_ERROR', '暂时无法恢复当前训练', 500)

  if (!enrollment) {
    return NextResponse.json({
      data: null,
      state: {
        kind: 'not_enrolled',
        message: '尚未启用训练方法',
      },
    })
  }

  const { data: cycle, error: cycleError } = await supabase
    .from('method_cycles')
    .select('id,cycle_number,status')
    .eq('enrollment_id', enrollment.id)
    .eq('status', 'in_progress')
    .order('cycle_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (cycleError) return apiError('DATABASE_ERROR', '暂时无法读取当前训练周期', 500)
  if (!cycle) return apiError('NOT_FOUND', '当前没有进行中的训练周期', 404)

  // Minimum P1 §13.1: the duration selector defaults to the long-term preference.
  const { data: capability } = await supabase
    .from('onboarding_capability_profiles')
    .select('preferred_session_minutes')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: prescriptionRows, error: prescriptionsError } = await supabase
    .from('session_prescriptions')
    .select('id,split_key,status,planned_for_date,cycle_id')
    .eq('cycle_id', cycle.id)
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .order('generated_at', { ascending: true })
  if (prescriptionsError) return apiError('DATABASE_ERROR', '暂时无法读取训练日', 500)

  // Never assume one session per prescription: the released uniqueness invariant
  // is dropped in supabase/cutover/, and Program Days can be re-executed.
  const rows = (prescriptionRows ?? []) as unknown as PrescriptionRow[]
  const bySplit = new Map<string, PrescriptionRow>()
  for (const row of rows) {
    if (!bySplit.has(row.split_key)) bySplit.set(row.split_key, row)
  }

  const nextSplitKey = isProgramDaySplit(enrollment.next_split_key)
    ? enrollment.next_split_key
    : null

  function firstIncompleteSplit() {
    for (const split of PROGRAM_DAY_ORDER) {
      if (bySplit.get(split)?.status !== 'completed') return split
    }
    return null
  }

  const targetSplit: ProgramDaySplit = requestedSplit
    ?? (activeSession && isProgramDaySplit(activeSession.split_key) ? activeSession.split_key as ProgramDaySplit : null)
    ?? nextSplitKey
    ?? firstIncompleteSplit()
    ?? 'push'

  // PRD §2.3: adjacent Program Days must be queryable/generatable, idempotently.
  if (!bySplit.has(targetSplit) || !bySplit.has(nextSplitKey ?? targetSplit)) {
    const missing = [targetSplit, nextSplitKey ?? targetSplit]
      .filter((split, index, all) => all.indexOf(split) === index)
      .filter((split) => !bySplit.has(split))
    for (const split of missing) {
      const { data: createdId, error: createError } = await supabase.rpc('create_program_day_prescription', {
        p_cycle_id: cycle.id,
        p_split_key: split,
      })
      if (createError) return apiError('DATABASE_ERROR', '暂时无法准备该训练日', 500)
      if (createdId) {
        bySplit.set(split, {
          id: createdId as string,
          split_key: split,
          status: 'ready',
          planned_for_date: null,
          cycle_id: cycle.id,
        })
      }
    }
  }

  const targetPrescription = bySplit.get(targetSplit)
  if (!targetPrescription) return apiError('NOT_FOUND', '该训练日还没有可执行的处方', 404)

  const { data: prescription, error } = await supabase
    .from('session_prescriptions')
    .select(TODAY_PRESCRIPTION_SELECT)
    .eq('user_id', user.id)
    .eq('id', targetPrescription.id)
    .maybeSingle()
  if (error) return apiError('DATABASE_ERROR', '暂时无法读取训练要求', 500)
  if (!prescription) return apiError('NOT_FOUND', '该训练日还没有可执行的处方', 404)

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
  const targetWorkoutActual = activeSession?.session_prescription_id === targetPrescription.id
    ? activeSession
    : null

  const days = PROGRAM_DAY_ORDER.map((split, index) => {
    const row = bySplit.get(split)
    const nameZh = split === targetSplit
      ? ((prescription.method_split as { name_zh?: string } | null)?.name_zh ?? PROGRAM_DAY_FALLBACK_NAMES[split])
      : PROGRAM_DAY_FALLBACK_NAMES[split]
    return {
      split_key: split,
      day_index: index + 1,
      name_zh: nameZh,
      status: row?.status ?? 'unavailable',
      completed: row?.status === 'completed',
      started: row?.status === 'started' || (activeSession?.split_key === split),
      available: Boolean(row),
      prescription_id: row?.id ?? null,
    }
  })

  return NextResponse.json({
    data: {
      program_day: {
        split_key: targetSplit,
        day_index: PROGRAM_DAY_ORDER.indexOf(targetSplit) + 1,
        name_zh: (prescription.method_split as { name_zh?: string } | null)?.name_zh
          ?? PROGRAM_DAY_FALLBACK_NAMES[targetSplit],
        cycle_number: cycle.cycle_number,
        prescription_id: prescription.id,
      },
      days,
      next_split_key: nextSplitKey,
      preferred_session_minutes: capability?.preferred_session_minutes ?? 60,
      current_log_date: currentLogDate,
      view_date: requestedDate,
      recovery: activeSession ? {
        kind: 'active_session',
        session_id: activeSession.id,
        split_key: activeSession.split_key,
        session_prescription_id: activeSession.session_prescription_id,
      } : null,
      prescription: { ...prescription, exercises },
      workout_actual: targetWorkoutActual,
    },
  })
}
