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

describe('动作走势页的数据', async () => {
  const { buildExerciseTrend, TREND_POINTS } = await import('@/lib/workout/exercise-history')
  const { formatSummary, formatTopSet, formatSessionSets } = await import('@/lib/workout/exercise-progress')
  const bench = { id: 'bench', canonical_name_zh: '杠铃卧推', record_shape: 'weight_reps' }

  it('只取这个动作、已完成的训练，按日期从旧到新，最多 12 次', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      row('bench', `s${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, [s(40 + i, 8)]))
    rows.push(row('squat', 'x', '2026-10-20', [s(100, 5)]))
    rows.push(row('bench', 'open', '2026-10-30', [s(99, 5)], 'started'))
    const trend = buildExerciseTrend(bench, rows)!
    expect(trend.points).toHaveLength(TREND_POINTS)
    expect(trend.points[0].date).toBe('2026-10-04')
    expect(trend.points.at(-1)!.topWeightKg).toBe(54)
    expect(trend.nameZh).toBe('杠铃卧推')
  })

  it('计时类动作不做走势；没有记录时点为空、总结为 none', () => {
    expect(buildExerciseTrend({ id: 'run', canonical_name_zh: '跑步', record_shape: 'duration' }, [])).toBeNull()
    const empty = buildExerciseTrend(bench, [])!
    expect(empty.points).toEqual([])
    expect(empty.summary.kind).toBe('none')
  })

  it('总结和主数字：中文逐字照旧，英文走字典、没有中文', () => {
    const rows = [
      row('bench', 'a', '2026-10-20', [s(40, 8)]),
      row('bench', 'b', '2026-11-17', [s(20, 10, { prescription: { set_type: 'warmup' } }), s(45, 8), s(45, 6)]),
    ]
    const trend = buildExerciseTrend(bench, rows)!
    expect(formatSummary(trend.summary, 'kg')).toBe('比 4 周前 +5 kg')
    expect(formatSummary(trend.summary, 'kg', 'en')).toBe('+5 kg vs 4 weeks ago')
    const latest = trend.points.at(-1)!
    expect(formatTopSet(latest, 'kg')).toBe('45 kg × 8')
    expect(formatSessionSets(latest, 'kg')).toBe('45 kg × 8, 6')
    expect(formatSummary({ kind: 'single' }, 'kg', 'en')).not.toMatch(/[一-鿿]/)
  })

  it('走势接口：开关关着 403、先查登录、只按本人 user_id 读', async () => {
    const { readFileSync } = await import('node:fs')
    const route = readFileSync('app/api/training/exercises/[exerciseId]/history/route.ts', 'utf8')
    expect(route).toContain('isExerciseProgressEnabled()')
    expect(route).toContain('auth.getUser()')
    const lib = readFileSync('lib/workout/exercise-history.ts', 'utf8')
    expect(lib).toMatch(/loadExerciseTrend[\s\S]*\.eq\('user_id', userId\)/)
  })
})
