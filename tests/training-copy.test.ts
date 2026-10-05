import { describe, expect, it } from 'vitest'
import { friendlyTargetSummary } from '../lib/training-copy'

describe('friendlyTargetSummary', () => {
  it('keeps plain summaries', () => {
    expect(friendlyTargetSummary('4 组 × 12 次')).toBe('4 组 × 12 次')
  })

  it('replaces engineering wording with the real sets', () => {
    const sets = [{ target_reps_min: 10, target_reps_max: 15 }, { target_reps_min: 10, target_reps_max: 15 }, { target_reps_min: 10, target_reps_max: 15 }]
    expect(friendlyTargetSummary('组次待严格方法证据；当前不可生成结构化组次', sets)).toBe('3 组 × 10–15 次')
    expect(friendlyTargetSummary('运行时默认', sets)).toBe('3 组 × 10–15 次')
  })

  it('says nothing when there is nothing to say', () => {
    expect(friendlyTargetSummary('组次待严格方法证据', [])).toBeNull()
  })

  it('describes timed sets', () => {
    expect(friendlyTargetSummary(null, [{ target_duration_seconds: 60 }, { target_duration_seconds: 60 }])).toBe('2 组 × 60 秒')
    expect(friendlyTargetSummary(null, [{ target_duration_seconds: 1800 }])).toBe('30 分钟')
  })
})
