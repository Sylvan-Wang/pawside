import type { SupabaseClient } from '@supabase/supabase-js'
import { SPLIT_LABELS } from './display'
import { coachDurationBasis } from './flags'
import { computeEffectiveDuration, type EffectiveDuration } from './session-duration'
import {
  buildKeySetHints,
  describePlannedSet,
  planNumbers,
  type PlannedExerciseInput,
  type PlannedSetInput,
} from './set-guidance'

/**
 * Pawside Coach — Method context for workout feedback (prompt v2).
 *
 * Reads the normalized runtime tables (workout_sessions / exercise_executions /
 * set_executions / *_prescriptions) for ONE completed Method session and
 * returns a bounded, already-interpreted summary. Raw rows never reach the
 * model.
 *
 * Uncertainty handling: every read is best-effort. Any query error, missing
 * relation or unexpected shape returns `null` (or drops that sub-part), and
 * workout feedback falls back to the old facts-only behaviour.
 */

export interface KeySetResult {
  set_index: number
  label: string
  target: string | null
  effort: string | null
  actual_reps: number | null
  actual_weight_kg: number | null
  logged: boolean
}

export interface ExerciseSummary {
  name: string
  order: number
  status: string
  /** Calibration exercises: finding a weight, never "progress". */
  calibration: boolean
  prescribed_set_count: number
  logged_set_count: number
  key_sets: KeySetResult[]
  last_time: { top_weight_kg: number; reps: number | null } | null
}

export interface MethodWorkoutContext {
  split_label: string
  execution_mode: string | null
  duration: EffectiveDuration
  exercises: ExerciseSummary[]
  prescribed_not_logged: Array<{ name: string; prescribed: number; logged: number }>
  skipped: string[]
  next_session: { split_label: string; key_sets: string[] } | null
  data_issues: string[]
  /** Rule-produced numbers the model may repeat (plan targets, actual reps/weights). */
  allowed_numbers: number[]
}

interface RawSetExecution {
  set_index: number
  set_prescription_id: string | null
  actual_weight_kg: number | string | null
  actual_reps: number | null
  status: string
  is_extra: boolean
  completed_at: string | null
}

interface RawExecution {
  id: string
  exercise_id: string
  order_index: number
  status: string
  exercise: { canonical_name_zh: string } | Array<{ canonical_name_zh: string }> | null
  prescription: {
    weight_guidance_type: string | null
    sets: Array<PlannedSetInput & { id: string }> | null
  } | Array<{
    weight_guidance_type: string | null
    sets: Array<PlannedSetInput & { id: string }> | null
  }> | null
  sets: RawSetExecution[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function loadLastTime(
  supabase: SupabaseClient,
  userId: string,
  session: { id: string; split_key: string; started_at: string },
): Promise<Map<string, { top_weight_kg: number; reps: number | null }>> {
  const result = new Map<string, { top_weight_kg: number; reps: number | null }>()
  const { data: previous, error } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('split_key', session.split_key)
    .eq('status', 'completed')
    .neq('id', session.id)
    .lt('started_at', session.started_at)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !previous) return result

  const { data: rows, error: rowsError } = await supabase
    .from('exercise_executions')
    .select('exercise_id, sets:set_executions(actual_weight_kg,actual_reps,status,is_extra)')
    .eq('workout_session_id', previous.id)
    .eq('user_id', userId)
  if (rowsError || !rows) return result

  for (const row of rows as Array<{ exercise_id: string; sets: RawSetExecution[] | null }>) {
    let best: { top_weight_kg: number; reps: number | null } | null = null
    for (const set of row.sets ?? []) {
      if (set.status !== 'completed') continue
      const weight = num(set.actual_weight_kg)
      if (weight === null) continue
      if (!best || weight > best.top_weight_kg) best = { top_weight_kg: weight, reps: set.actual_reps ?? null }
    }
    if (best) result.set(row.exercise_id, best)
  }
  return result
}

async function loadNextSession(
  supabase: SupabaseClient,
  userId: string,
  enrollmentId: string,
): Promise<{ split_label: string; key_sets: string[]; plan: PlannedExerciseInput[] } | null> {
  const { data: enrollment, error } = await supabase
    .from('method_enrollments')
    .select('next_split_key')
    .eq('id', enrollmentId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !enrollment?.next_split_key) return null
  const splitLabel = SPLIT_LABELS[enrollment.next_split_key] ?? enrollment.next_split_key

  const { data: prescription } = await supabase
    .from('session_prescriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('enrollment_id', enrollmentId)
    .eq('split_key', enrollment.next_split_key)
    .in('status', ['upcoming', 'ready'])
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  // The next prescription may not be generated yet. That is not an error.
  if (!prescription) return { split_label: splitLabel, key_sets: [], plan: [] }

  const { data: exercises, error: exercisesError } = await supabase
    .from('exercise_prescriptions')
    .select('order_index, weight_guidance_type, exercise:exercises(canonical_name_zh), sets:set_prescriptions(*)')
    .eq('session_prescription_id', prescription.id)
    .order('order_index')
  if (exercisesError || !exercises) return { split_label: splitLabel, key_sets: [], plan: [] }

  const plan: PlannedExerciseInput[] = (exercises as Array<{
    weight_guidance_type: string | null
    exercise: { canonical_name_zh: string } | Array<{ canonical_name_zh: string }> | null
    sets: PlannedSetInput[] | null
  }>).map((row) => ({
    exercise_name: one(row.exercise)?.canonical_name_zh ?? '这个动作',
    weight_guidance_type: row.weight_guidance_type,
    sets: row.sets ?? [],
  }))

  return {
    split_label: splitLabel,
    key_sets: buildKeySetHints(plan).map((hint) => hint.text),
    plan,
  }
}

export async function loadMethodWorkoutContext(
  supabase: SupabaseClient,
  userId: string,
  methodWorkoutSessionId: string,
): Promise<MethodWorkoutContext | null> {
  try {
    const { data: session, error } = await supabase
      .from('workout_sessions')
      .select('id, enrollment_id, split_key, execution_mode, started_at, completed_at, duration_minutes')
      .eq('id', methodWorkoutSessionId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !session) return null

    const { data: executions, error: executionsError } = await supabase
      .from('exercise_executions')
      .select(`
        id, exercise_id, order_index, status,
        exercise:exercises(canonical_name_zh),
        prescription:exercise_prescriptions(weight_guidance_type, sets:set_prescriptions(*)),
        sets:set_executions(set_index,set_prescription_id,actual_weight_kg,actual_reps,status,is_extra,completed_at)
      `)
      .eq('workout_session_id', session.id)
      .eq('user_id', userId)
      .order('order_index')
    if (executionsError || !executions) return null

    const lastTime = await loadLastTime(supabase, userId, session).catch(() => new Map())
    const allowed = new Set<number>()
    const setCompletedAts: string[] = []
    const exercises: ExerciseSummary[] = []
    const prescribedNotLogged: MethodWorkoutContext['prescribed_not_logged'] = []
    const skipped: string[] = []

    for (const raw of executions as unknown as RawExecution[]) {
      const name = one(raw.exercise)?.canonical_name_zh ?? '这个动作'
      const prescription = one(raw.prescription)
      const plannedSets = [...(prescription?.sets ?? [])].sort((a, b) => a.set_index - b.set_index)
      const actualSets = raw.sets ?? []
      const completedActual = actualSets.filter((set) => set.status === 'completed')
      for (const set of completedActual) {
        if (set.completed_at) setCompletedAts.push(set.completed_at)
        if (set.actual_reps !== null) allowed.add(set.actual_reps)
        const weight = num(set.actual_weight_kg)
        if (weight !== null) allowed.add(weight)
      }

      const loggedPlanned = completedActual.filter((set) => !set.is_extra).length
      const keySets: KeySetResult[] = plannedSets
        .filter((planned) => describePlannedSet(planned).emphasis)
        .map((planned) => {
          const guidance = describePlannedSet(planned)
          const actual = completedActual.find((set) => (
            (set.set_prescription_id && set.set_prescription_id === planned.id)
            || (!set.is_extra && set.set_index === planned.set_index)
          ))
          return {
            set_index: planned.set_index,
            label: guidance.label,
            target: guidance.target,
            effort: guidance.effort,
            actual_reps: actual?.actual_reps ?? null,
            actual_weight_kg: actual ? num(actual.actual_weight_kg) : null,
            logged: Boolean(actual),
          }
        })

      const previous = lastTime.get(raw.exercise_id) ?? null
      if (previous) {
        allowed.add(previous.top_weight_kg)
        if (previous.reps !== null) allowed.add(previous.reps)
      }

      if (raw.status === 'skipped') skipped.push(name)
      else if (plannedSets.length > 0 && loggedPlanned < plannedSets.length) {
        prescribedNotLogged.push({ name, prescribed: plannedSets.length, logged: loggedPlanned })
        allowed.add(plannedSets.length)
        allowed.add(loggedPlanned)
      }

      exercises.push({
        name,
        order: raw.order_index,
        status: raw.status,
        calibration: prescription?.weight_guidance_type === 'calibration',
        prescribed_set_count: plannedSets.length,
        logged_set_count: loggedPlanned,
        key_sets: keySets,
        last_time: previous,
      })

      for (const value of planNumbers([{ exercise_name: name, sets: plannedSets }])) allowed.add(value)
    }

    const duration = computeEffectiveDuration({
      basis: coachDurationBasis(),
      startedAt: session.started_at,
      completedAt: session.completed_at,
      setCompletedAts,
      storedMinutes: session.duration_minutes,
    })

    const next = await loadNextSession(supabase, userId, session.enrollment_id).catch(() => null)
    if (next) for (const value of planNumbers(next.plan)) allowed.add(value)

    const dataIssues: string[] = []
    if (duration.excluded) dataIssues.push('这次记录的训练时长明显异常，已不计入分析')

    return {
      split_label: SPLIT_LABELS[session.split_key] ?? session.split_key,
      execution_mode: session.execution_mode ?? null,
      duration,
      exercises,
      prescribed_not_logged: prescribedNotLogged,
      skipped,
      next_session: next ? { split_label: next.split_label, key_sets: next.key_sets } : null,
      data_issues: dataIssues,
      allowed_numbers: [...allowed],
    }
  } catch {
    return null
  }
}
