/**
 * 逐组记录页「上次」一行的数据（#48，方案 docs/product/exercise-progress.md 第 5 节第 3 条）。
 *
 * 只读登录用户自己的记录（RLS 本来就只让读自己的，这里再按 user_id 过滤一次）。
 * 不用 AI，不写数据库。开关 NEXT_PUBLIC_EXERCISE_PROGRESS，默认关；关着时不查、不返回。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildProgressPoints, lastPointBefore,
  type ProgressPoint, type ProgressSessionInput, type ProgressShape,
} from '@/lib/workout/exercise-progress'

export function isExerciseProgressEnabled(flag: string | undefined = process.env.NEXT_PUBLIC_EXERCISE_PROGRESS): boolean {
  return flag === '1' || flag === 'true'
}

/** 每个动作最多看最近几次训练。「上次」只要 1 次，留余量给被跳过的（没有正式组的）训练。 */
export const HISTORY_SESSIONS_PER_EXERCISE = 12

export interface HistoryRow {
  exercise_id: string
  workout_session_id: string
  session: { log_date: string | null; status: string | null } | Array<{ log_date: string | null; status: string | null }> | null
  sets: Array<{
    actual_weight_kg: number | string | null
    actual_reps: number | null
    status: string | null
    is_extra: boolean | null
    prescription: { set_type: string | null } | Array<{ set_type: string | null }> | null
  }> | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function toShape(recordShape: string | null | undefined): ProgressShape | null {
  if (recordShape === 'bodyweight_reps') return 'bodyweight_reps'
  if (recordShape == null || recordShape === 'weight_reps') return 'weight_reps'
  return null // duration / distance_duration：方案里不做
}

/**
 * 纯函数：把查询结果按动作分组，算出每个动作「今天之前最近一次」的点。
 * 只用已完成的训练；跳过正在练的这次；计时类动作不返回。
 */
export function lastPointsByExercise(
  rows: HistoryRow[],
  recordShapes: Record<string, string | null | undefined>,
  currentSessionId: string,
  today: string,
): Record<string, ProgressPoint> {
  const byExercise = new Map<string, ProgressSessionInput[]>()
  for (const row of rows) {
    if (row.workout_session_id === currentSessionId) continue
    const session = one(row.session)
    if (!session || session.status !== 'completed' || !session.log_date) continue
    const list = byExercise.get(row.exercise_id) ?? []
    list.push({
      sessionId: row.workout_session_id,
      date: session.log_date,
      sets: (row.sets ?? []).map(set => ({
        weightKg: set.actual_weight_kg == null ? null : Number(set.actual_weight_kg),
        reps: set.actual_reps,
        completed: set.status === 'completed',
        isExtra: set.is_extra === true,
        setType: one(set.prescription)?.set_type ?? null,
      })),
    })
    byExercise.set(row.exercise_id, list)
  }

  const result: Record<string, ProgressPoint> = {}
  for (const [exerciseId, sessions] of byExercise) {
    const shape = toShape(recordShapes[exerciseId])
    if (!shape) continue
    const last = lastPointBefore(buildProgressPoints(sessions, shape), currentSessionId, today)
    if (last) result[exerciseId] = last
  }
  return result
}

/** 读最近的已完成训练里这些动作的组记录。失败时返回空对象：「上次」只是提示，不能挡住记录页。 */
export async function loadLastPoints(
  supabase: SupabaseClient,
  userId: string,
  exercises: Array<{ exerciseId: string; recordShape: string | null | undefined }>,
  currentSessionId: string,
  today: string,
): Promise<Record<string, ProgressPoint>> {
  const ids = [...new Set(exercises.map(e => e.exerciseId).filter(Boolean))]
  if (ids.length === 0) return {}
  const { data, error } = await supabase
    .from('exercise_executions')
    .select(`
      exercise_id,
      workout_session_id,
      session:workout_sessions!inner(log_date,status),
      sets:set_executions(actual_weight_kg,actual_reps,status,is_extra,prescription:set_prescriptions(set_type))
    `)
    .eq('user_id', userId)
    .in('exercise_id', ids)
    .neq('workout_session_id', currentSessionId)
    .eq('session.status', 'completed')
    .order('created_at', { ascending: false })
    .limit(ids.length * HISTORY_SESSIONS_PER_EXERCISE)
  if (error || !data) return {}
  const shapes: Record<string, string | null | undefined> = {}
  for (const e of exercises) shapes[e.exerciseId] = e.recordShape
  return lastPointsByExercise(data as unknown as HistoryRow[], shapes, currentSessionId, today)
}
