import type { SupabaseClient } from '@supabase/supabase-js'
import { invalidateDayDerivedCache } from '../utils'
import type { DateSource } from './dates'
import type { PlanTask } from './schemas'
import type { DraftRow, WorkoutDraftPayload } from './types'

/**
 * Actual workouts logged from chat go to workout_logs (free workouts), through
 * the same idempotent RPC any caller can use. They never touch set_executions:
 * "complete this set" stays a deliberate tap in the training runner (HANDOFF §4).
 */

const SIMILAR_MINUTES = 10

export async function buildWorkoutPayload(input: {
  supabase: SupabaseClient
  userId: string
  task: Extract<PlanTask, { kind: 'log_workout' }>
  date: string
  dateSource: DateSource
  rawText: string
}): Promise<WorkoutDraftPayload> {
  const { data } = await input.supabase
    .from('workout_logs')
    .select('id,type,duration_minutes,method_workout_session_id')
    .eq('user_id', input.userId)
    .eq('date', input.date)

  const duplicates: WorkoutDraftPayload['possible_duplicates'] = []
  for (const row of data ?? []) {
    const minutes = row.duration_minutes === null ? null : Number(row.duration_minutes)
    const label = `${row.type}${minutes === null ? '' : ` ${minutes}分钟`}`
    if (row.method_workout_session_id) {
      // The training runner already recorded a session that day: the likeliest
      // double-entry. Shown to the user, never blocking.
      duplicates.push({ id: row.id as string, label: `训练记录里已有：${label}`, source: 'method' })
    } else if (
      row.type === input.task.workoutType
      && minutes !== null
      && Math.abs(minutes - input.task.minutes) <= SIMILAR_MINUTES
    ) {
      duplicates.push({ id: row.id as string, label: `已有一条：${label}`, source: 'free' })
    }
  }

  return {
    v: 1,
    date: input.date,
    date_source: input.dateSource,
    workout_type: input.task.workoutType,
    minutes: input.task.minutes,
    calories: input.task.calories,
    notes: input.task.notes,
    raw_text: input.rawText.slice(0, 500),
    possible_duplicates: duplicates.slice(0, 3),
  }
}

export async function commitWorkout(
  supabase: SupabaseClient,
  userId: string,
  draft: DraftRow,
): Promise<{ workoutLogId: string; idempotent: boolean; date: string }> {
  const payload = draft.payload as WorkoutDraftPayload
  const { data, error } = await supabase.rpc('save_workout_log_v1', {
    p_request_id: draft.request_id,
    p_date: payload.date,
    p_type: payload.workout_type,
    p_duration_minutes: payload.minutes,
    p_notes: payload.notes,
    p_exercises: [],
    p_calories_burned_kcal: payload.calories,
    p_input_source: 'coach_chat',
  })
  if (error || !data) {
    const failure = new Error(error?.message || '无法保存运动记录') as Error & { code?: string }
    failure.code = error?.code
    throw failure
  }
  const result = data as { workout_log_id: string; idempotent: boolean }
  await invalidateDayDerivedCache(supabase, userId, payload.date)
  return { workoutLogId: result.workout_log_id, idempotent: result.idempotent, date: payload.date }
}
