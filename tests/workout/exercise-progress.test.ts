import { describe, expect, it } from 'vitest'
import {
  buildProgressPoints, formatLastTime, formatSummary, lastPointBefore, summarizeProgress,
  type ProgressSessionInput,
} from '@/lib/workout/exercise-progress'

const set = (weightKg: number | null, reps: number | null, extra: Partial<{ completed: boolean; isExtra: boolean; setType: string }> = {}) =>
  ({ weightKg, reps, completed: true, ...extra })

const bench: ProgressSessionInput[] = [
  { sessionId: 's1', date: '2026-10-20', sets: [set(20, 10, { setType: 'warmup' }), set(40, 8), set(40, 8), set(40, 7)] },
  { sessionId: 's2', date: '2026-11-03', sets: [set(42.5, 8), set(42.5, 8), set(42.5, 8)] },
  { sessionId: 's3', date: '2026-11-17', sets: [set(45, 8), set(45, 8), set(45, 6), set(60, 1, { isExtra: true })] },
]

describe('按动作看重量走势：每次训练的点', () => {
  it('排除热身组、计划外组和没完成的组', () => {
    const points = buildProgressPoints([
      { sessionId: 'a', date: '2026-11-01', sets: [set(20, 10, { setType: 'warmup' }), set(50, 5, { completed: false }), set(40, 8), set(70, 1, { isExtra: true })] },
    ], 'weight_reps')
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ topWeightKg: 40, topReps: 8, totalReps: 8, volumeKg: 320 })
  })

  it('同重量取次数多的那组', () => {
    const [p] = buildProgressPoints([{ sessionId: 'a', date: '2026-11-01', sets: [set(40, 6), set(40, 9), set(35, 12)] }], 'weight_reps')
    expect(p.topWeightKg).toBe(40)
    expect(p.topReps).toBe(9)
    expect(p.totalReps).toBe(27)
  })

  it('没有正式组的训练不算一个点，结果按日期排序', () => {
    const points = buildProgressPoints([
      bench[2], { sessionId: 'x', date: '2026-11-10', sets: [set(20, 10, { setType: 'warmup' })] }, bench[0],
    ], 'weight_reps')
    expect(points.map(p => p.sessionId)).toEqual(['s1', 's3'])
  })

  it('徒手动作只看次数，不要求重量', () => {
    const [p] = buildProgressPoints([{ sessionId: 'a', date: '2026-11-01', sets: [set(null, 10), set(null, 12), set(null, 9)] }], 'bodyweight_reps')
    expect(p).toMatchObject({ topWeightKg: null, topReps: 12, totalReps: 31, volumeKg: null })
  })
})

describe('一句话总结', () => {
  const points = buildProgressPoints(bench, 'weight_reps')

  it('比 4 周前重了', () => {
    const s = summarizeProgress(points, 'weight_reps')
    expect(s).toEqual({ kind: 'heavier', deltaKg: 5, sinceDate: '2026-10-20', weeks: 4 })
    expect(formatSummary(s, 'kg')).toBe('比 4 周前 +5 kg')
  })

  it('不到 4 周就和第一次比', () => {
    const s = summarizeProgress(points.slice(1), 'weight_reps')
    expect(s).toMatchObject({ kind: 'heavier', deltaKg: 2.5, weeks: null })
    expect(formatSummary(s, 'kg')).toBe('比第一次（11/3）+2.5 kg')
  })

  it('重量一样、次数多了', () => {
    const p = buildProgressPoints([
      { sessionId: 'a', date: '2026-11-01', sets: [set(45, 6)] },
      { sessionId: 'b', date: '2026-11-08', sets: [set(45, 8)] },
    ], 'weight_reps')
    expect(formatSummary(summarizeProgress(p, 'weight_reps'), 'kg')).toBe('同样 45 kg，多做了 2 次')
  })

  it('只有 1 次', () => {
    const s = summarizeProgress(points.slice(0, 1), 'weight_reps')
    expect(formatSummary(s, 'kg')).toBe('练两次以上就能看到走势')
  })

  it('连续 3 次持平，不给建议', () => {
    const p = buildProgressPoints(['2026-11-01', '2026-11-04', '2026-11-08'].map((date, i) => ({
      sessionId: `f${i}`, date, sets: [set(45, 8), set(45, 7)],
    })), 'weight_reps')
    const s = summarizeProgress(p, 'weight_reps')
    expect(s).toEqual({ kind: 'flat', sessions: 3 })
    expect(formatSummary(s, 'kg')).toBe('最近 3 次持平')
  })

  it('选 lb 时只换算显示，数字来自 kg', () => {
    const s = summarizeProgress(points, 'weight_reps')
    expect(formatSummary(s, 'lb')).toBe('比 4 周前 +11 lb')
    expect(points[2].topWeightKg).toBe(45)
  })
})

describe('逐组记录页「上次」', () => {
  const points = buildProgressPoints(bench, 'weight_reps')

  it('跳过正在练的这次', () => {
    expect(lastPointBefore(points, 's3', '2026-11-17')?.sessionId).toBe('s2')
  })

  it('没有上一次就不显示', () => {
    expect(lastPointBefore(points.slice(0, 1), 's1', '2026-10-20')).toBeNull()
  })

  it('各组同重量合并写', () => {
    expect(formatLastTime(points[0], 'kg')).toBe('上次 10/20：40 kg × 8, 8, 7')
  })

  it('各组重量不同逐组写', () => {
    const [p] = buildProgressPoints([{ sessionId: 'a', date: '2026-11-12', sets: [set(40, 8), set(42.5, 6)] }], 'weight_reps')
    expect(formatLastTime(p, 'kg')).toBe('上次 11/12：40×8, 42.5×6 kg')
  })

  it('徒手动作只写次数', () => {
    const [p] = buildProgressPoints([{ sessionId: 'a', date: '2026-11-12', sets: [set(null, 10), set(null, 8)] }], 'bodyweight_reps')
    expect(formatLastTime(p, 'kg')).toBe('上次 11/12：10, 8 次')
  })
})
