import type { SupabaseClient } from '@supabase/supabase-js'
import { loadLastTime } from '../coach/workout-context'
import { describePlannedSet, type PlannedSetInput } from '../coach/set-guidance'

export interface DailyWorkoutSetCard {
  set_index: number
  set_type: string
  recorded: boolean
  weight_kg: number | null
  reps: number | null
  target_reps: string | null
  rest_pause_segments: string | null
}

export interface DailyWorkoutExerciseCard {
  exercise_id: string
  name: string
  order: number
  important: boolean
  comparison: string | null
  sets: DailyWorkoutSetCard[]
}

export interface DailyWorkoutCard {
  session_id: string
  split_key: string
  split_label: string
  cycle_number: number
  completed_exercise_count: number
  planned_exercise_count: number
  headline: string | null
  exercises: DailyWorkoutExerciseCard[]
}

interface RawActualSet {
  set_index: number
  set_prescription_id: string | null
  actual_weight_kg: number | string | null
  actual_reps: number | null
  status: string
  is_extra: boolean
}

interface RawExercise {
  exercise_id: string
  order_index: number
  status: string
  exercise: { canonical_name_zh: string } | Array<{ canonical_name_zh: string }> | null
  prescription: {
    method_role: string
    sets: Array<PlannedSetInput & { id: string; quality_requirement?: string | null }> | null
  } | Array<{
    method_role: string
    sets: Array<PlannedSetInput & { id: string; quality_requirement?: string | null }> | null
  }> | null
  sets: RawActualSet[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function repsTarget(set: PlannedSetInput): string | null {
  if (set.target_reps_min == null && set.target_reps_max == null) return null
  if (set.target_reps_min === set.target_reps_max || set.target_reps_max == null) return `${set.target_reps_min}`
  if (set.target_reps_min == null) return `${set.target_reps_max}`
  return `${set.target_reps_min}–${set.target_reps_max}`
}

function restPauseSegments(set: PlannedSetInput & { quality_requirement?: string | null }): string | null {
  if (set.set_type !== 'rest_pause') return null
  const target = describePlannedSet(set).target
  const match = target?.match(/(\d+)\s*\+\s*(\d+)/)
  return match ? `${match[1]}+${match[2]}` : null
}

export function comparisonLabel(
  current: { top_weight_kg: number; reps: number | null } | null,
  previous: { top_weight_kg: number; reps: number | null } | null,
): string | null {
  if (!current) return null
  if (!previous) return '第一次练'
  if (current.top_weight_kg > previous.top_weight_kg) {
    const increase = Math.round((current.top_weight_kg - previous.top_weight_kg) * 10) / 10
    return `↑ 重量 +${increase} kg`
  }
  if (current.top_weight_kg === previous.top_weight_kg && current.reps !== null && previous.reps !== null && current.reps > previous.reps) {
    return `↑ 比上次多 ${current.reps - previous.reps} 次`
  }
  return null
}

function topSet(sets: RawActualSet[]): { top_weight_kg: number; reps: number | null } | null {
  let best: { top_weight_kg: number; reps: number | null } | null = null
  for (const set of sets) {
    if (set.status !== 'completed') continue
    const weight = numberOrNull(set.actual_weight_kg)
    if (weight === null) continue
    if (!best || weight > best.top_weight_kg || (weight === best.top_weight_kg && (set.actual_reps ?? -1) > (best.reps ?? -1))) {
      best = { top_weight_kg: weight, reps: set.actual_reps }
    }
  }
  return best
}

export async function loadDailyWorkoutCards(
  supabase: SupabaseClient,
  userId: string,
  date: string,
): Promise<DailyWorkoutCard[]> {
  const { data: sessions, error } = await supabase
    .from('workout_sessions')
    .select('id,cycle_id,enrollment_id,split_key,started_at,completed_at,completed_exercise_count')
    .eq('user_id', userId)
    .eq('log_date', date)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .order('completed_at', { ascending: true })
  if (error) throw new Error(error.message)

  return Promise.all((sessions ?? []).map(async (session): Promise<DailyWorkoutCard> => {
    const [{ data: cycle }, { data: rawExercises, error: exerciseError }, { data: log }, { data: enrollment }] = await Promise.all([
      supabase.from('method_cycles').select('cycle_number').eq('id', session.cycle_id).maybeSingle(),
      supabase
        .from('exercise_executions')
        .select(`
          exercise_id,order_index,status,
          exercise:exercises(canonical_name_zh),
          prescription:exercise_prescriptions(method_role,sets:set_prescriptions(id,set_index,set_type,target_reps_min,target_reps_max,target_rpe,target_rir,failure_allowed,failure_required,target_weight_kg,rest_min_seconds,rest_max_seconds,quality_requirement)),
          sets:set_executions(set_index,set_prescription_id,actual_weight_kg,actual_reps,status,is_extra)
        `)
        .eq('workout_session_id', session.id)
        .eq('user_id', userId)
        .order('order_index'),
      supabase
        .from('workout_logs')
        .select('id')
        .eq('user_id', userId)
        .eq('method_workout_session_id', session.id)
        .maybeSingle(),
      supabase.from('method_enrollments').select('method_release_id').eq('id', session.enrollment_id).maybeSingle(),
    ])
    if (exerciseError) throw new Error(exerciseError.message)

    const rows = (rawExercises ?? []) as unknown as RawExercise[]
    const previous = await loadLastTime(
      supabase,
      userId,
      { id: session.id, started_at: session.started_at },
      rows.map((row) => row.exercise_id),
    )

    let headline: string | null = null
    if (log?.id) {
      const { data: generation } = await supabase
        .from('ai_generations')
        .select('output')
        .eq('user_id', userId)
        .eq('surface', 'workout_session_feedback')
        .eq('scope_id', log.id)
        .eq('status', 'ok')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const output = generation?.output as { headline?: unknown } | null
      headline = typeof output?.headline === 'string' ? output.headline : null
    }

    const { data: split } = enrollment?.method_release_id
      ? await supabase
        .from('method_splits')
        .select('name_zh')
        .eq('method_release_id', enrollment.method_release_id)
        .eq('key', session.split_key)
        .maybeSingle()
      : { data: null }

    const exercises = rows.map((row): DailyWorkoutExerciseCard => {
      const prescription = one(row.prescription)
      const planned = [...(prescription?.sets ?? [])].sort((a, b) => a.set_index - b.set_index)
      const actual = row.sets ?? []
      const completed = actual.filter((set) => set.status === 'completed')
      const sets: DailyWorkoutSetCard[] = planned.map((set) => {
        const recorded = completed.find((entry) => entry.set_prescription_id
          ? entry.set_prescription_id === set.id
          : !entry.is_extra && entry.set_index === set.set_index)
        return {
          set_index: set.set_index,
          set_type: set.set_type ?? 'other',
          recorded: Boolean(recorded),
          weight_kg: numberOrNull(recorded?.actual_weight_kg),
          reps: recorded?.actual_reps ?? null,
          target_reps: repsTarget(set),
          rest_pause_segments: restPauseSegments(set),
        }
      })
      for (const set of completed.filter((entry) => entry.is_extra)) {
        sets.push({
          set_index: set.set_index,
          set_type: 'other',
          recorded: true,
          weight_kg: numberOrNull(set.actual_weight_kg),
          reps: set.actual_reps,
          target_reps: null,
          rest_pause_segments: null,
        })
      }
      const important = prescription?.method_role === 'primary'
        || planned.some((set) => describePlannedSet(set).emphasis)
      return {
        exercise_id: row.exercise_id,
        name: one(row.exercise)?.canonical_name_zh ?? '这个动作',
        order: row.order_index,
        important,
        comparison: comparisonLabel(topSet(completed), previous.get(row.exercise_id) ?? null),
        sets,
      }
    }).sort((a, b) => Number(b.important) - Number(a.important) || a.order - b.order)

    return {
      session_id: session.id,
      split_key: session.split_key,
      split_label: split?.name_zh ?? '',
      cycle_number: Number(cycle?.cycle_number ?? 1),
      completed_exercise_count: Number(session.completed_exercise_count ?? rows.filter((row) => row.status === 'completed').length),
      planned_exercise_count: rows.length,
      headline,
      exercises,
    }
  }))
}
