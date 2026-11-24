/**
 * 逐组记录页「上次」一行的数据（#48，方案 docs/product/exercise-progress.md 第 5 节第 3 条）。
 *
 * 只读登录用户自己的记录（RLS 本来就只让读自己的，这里再按 user_id 过滤一次）。
 * 不用 AI，不写数据库。开关 NEXT_PUBLIC_EXERCISE_PROGRESS，默认关；关着时不查、不返回。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildProgressPoints, lastPointBefore, summarizeProgress,
  type ProgressPoint, type ProgressSessionInput, type ProgressShape, type ProgressSummary,
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

/** 纯函数：把查询结果按动作分组成「每次训练一组正式组记录」。只用已完成的训练，可排除一次训练。 */
export function sessionsByExercise(rows: HistoryRow[], excludeSessionId: string | null = null): Map<string, ProgressSessionInput[]> {
  const byExercise = new Map<string, ProgressSessionInput[]>()
  for (const row of rows) {
    if (excludeSessionId && row.workout_session_id === excludeSessionId) continue
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
  return byExercise
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
  const result: Record<string, ProgressPoint> = {}
  for (const [exerciseId, sessions] of sessionsByExercise(rows, currentSessionId)) {
    const shape = toShape(recordShapes[exerciseId])
    if (!shape) continue
    const last = lastPointBefore(buildProgressPoints(sessions, shape), currentSessionId, today)
    if (last) result[exerciseId] = last
  }
  return result
}

/** 动作走势页最多画几次训练（方案 4.2：只画最近 12 次）。 */
export const TREND_POINTS = 12

export interface ExerciseTrend {
  exerciseId: string
  /** exercises.canonical_name_zh；英文名由页面按字典换。 */
  nameZh: string
  shape: ProgressShape
  /** 从旧到新，最多 TREND_POINTS 个。 */
  points: ProgressPoint[]
  summary: ProgressSummary
}

/** 纯函数：一个动作的走势。计时类动作返回 null（方案里不做）。 */
export function buildExerciseTrend(
  exercise: { id: string; canonical_name_zh: string; record_shape: string | null },
  rows: HistoryRow[],
): ExerciseTrend | null {
  const shape = toShape(exercise.record_shape)
  if (!shape) return null
  const sessions = sessionsByExercise(rows.filter(row => row.exercise_id === exercise.id)).get(exercise.id) ?? []
  const points = buildProgressPoints(sessions, shape).slice(-TREND_POINTS)
  return { exerciseId: exercise.id, nameZh: exercise.canonical_name_zh, shape, points, summary: summarizeProgress(points, shape) }
}

const HISTORY_SELECT = `
      exercise_id,
      workout_session_id,
      session:workout_sessions!inner(log_date,status),
      sets:set_executions(actual_weight_kg,actual_reps,status,is_extra,prescription:set_prescriptions(set_type))
    `

/**
 * 动作走势页的数据：登录用户自己这个动作最近的已完成训练。
 * 动作不存在返回 'not_found'；查询出错返回 'error'；计时类动作返回 null。
 */
export async function loadExerciseTrend(
  supabase: SupabaseClient,
  userId: string,
  exerciseId: string,
): Promise<ExerciseTrend | null | 'not_found' | 'error'> {
  const { data: exercise, error: exerciseError } = await supabase
    .from('exercises')
    .select('id,canonical_name_zh,record_shape')
    .eq('id', exerciseId)
    .maybeSingle()
  if (exerciseError) return 'error'
  if (!exercise) return 'not_found'
  const { data, error } = await supabase
    .from('exercise_executions')
    .select(HISTORY_SELECT)
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId)
    .eq('session.status', 'completed')
    .order('created_at', { ascending: false })
    .limit(TREND_POINTS * 2)
  if (error || !data) return 'error'
  return buildExerciseTrend(
    exercise as { id: string; canonical_name_zh: string; record_shape: string | null },
    data as unknown as HistoryRow[],
  )
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
    .select(HISTORY_SELECT)
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
