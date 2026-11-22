import { describe, expect, it } from 'vitest'
import { isExerciseProgressEnabled, lastPointsByExercise, type HistoryRow } from '@/lib/workout/exercise-history'
import { formatLastTime } from '@/lib/workout/exercise-progress'

type RowSet = NonNullable<HistoryRow['sets']>[number]
const s = (w: number | string | null, reps: number | null, extra: Partial<RowSet> = {}): RowSet => ({
  actual_weight_kg: w, actual_reps: reps, status: 'completed', is_extra: false, prescription: { set_type: 'working' }, ...extra,
})
const row = (exercise: string, session: string, date: string, sets: RowSet[], status = 'completed'): HistoryRow => ({
  exercise_id: exercise, workout_session_id: session, session: { log_date: date, status }, sets,
})

describe('「上次」一行的数据', () => {
  it('开关默认关，只有 1 / true 打开', () => {
    expect(isExerciseProgressEnabled(undefined)).toBe(false)
    expect(isExerciseProgressEnabled('0')).toBe(false)
    expect(isExerciseProgressEnabled('1')).toBe(true)
    expect(isExerciseProgressEnabled('true')).toBe(true)
  })

  it('每个动作取今天之前最近一次已完成训练，排除热身组；数据库的 numeric 字符串也能读', () => {
    const rows = [
      row('bench', 'old', '2026-11-10', [s('40.000', 8), s('40.000', 8)]),
      row('bench', 'last', '2026-11-17', [s(20, 10, { prescription: { set_type: 'warmup' } }), s('42.500', 8), s('42.500', 7)]),
      row('squat', 'last', '2026-11-17', [s(60, 5)]),
    ]
    const result = lastPointsByExercise(rows, { bench: 'weight_reps', squat: 'weight_reps' }, 'now', '2026-11-22')
    expect(result.bench.sessionId).toBe('last')
    expect(formatLastTime(result.bench, 'kg')).toBe('上次 11/17：42.5 kg × 8, 7')
    expect(result.squat.topWeightKg).toBe(60)
  })

  it('跳过正在练的这次、没完成的训练、以后日期的训练', () => {
    const rows = [
      row('bench', 'now', '2026-11-22', [s(50, 8)], 'started'),
      row('bench', 'abandoned', '2026-11-20', [s(48, 8)], 'started'),
      row('bench', 'future', '2026-11-25', [s(49, 8)]),
      row('bench', 'ok', '2026-11-15', [s(45, 8)]),
    ]
    const result = lastPointsByExercise(rows, { bench: 'weight_reps' }, 'now', '2026-11-22')
    expect(result.bench.sessionId).toBe('ok')
  })

  it('没有上一次就不返回；计时类动作不返回；计划外组不进', () => {
    const rows = [
      row('plank', 'a', '2026-11-15', [s(null, 1)]),
      row('pullup', 'a', '2026-11-15', [s(null, 10, { is_extra: true })]),
    ]
    const result = lastPointsByExercise(rows, { plank: 'duration', pullup: 'bodyweight_reps' }, 'now', '2026-11-22')
    expect(result).toEqual({})
  })

  it('徒手动作只写次数；lb 只换算显示', () => {
    const rows = [
      row('pushup', 'a', '2026-11-15', [s(null, 12), s(null, 10)]),
      row('bench', 'a', '2026-11-15', [s(40, 8)]),
    ]
    const result = lastPointsByExercise(rows, { pushup: 'bodyweight_reps', bench: null }, 'now', '2026-11-22')
    expect(formatLastTime(result.pushup, 'kg')).toBe('上次 11/15：12, 10 次')
    expect(formatLastTime(result.bench, 'lb')).toMatch(/^上次 11\/15：[\d.]+ lb × 8$/)
  })
})
