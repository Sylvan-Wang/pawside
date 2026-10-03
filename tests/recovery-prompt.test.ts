import { describe, expect, it } from 'vitest'
import { buildRecoveryWorkoutPrompt, recoveryFollowUp } from '../lib/recovery-prompt'

describe('recovery prompt', () => {
  it.each([
    ['push', '推', '胸、肩、三头'],
    ['pull', '拉', '背、二头'],
    ['legs', '腿', '大腿、臀'],
  ])('maps %s to user-facing copy', (splitKey, label, muscles) => {
    expect(buildRecoveryWorkoutPrompt({
      splitKey,
      logDate: '2026-10-02',
      today: '2026-10-03',
      yesterday: '2026-10-02',
      twoDaysAgo: '2026-10-01',
      nextSplitKey: splitKey,
    })).toMatchObject({ days_ago: 1, split_label: label, muscles, same_as_next: true })
  })

  it('uses the day-before-yesterday label and hides older workouts', () => {
    expect(buildRecoveryWorkoutPrompt({
      splitKey: 'push', logDate: '2026-10-01', today: '2026-10-03',
      yesterday: '2026-10-02', twoDaysAgo: '2026-10-01', nextSplitKey: 'pull',
    })?.days_ago).toBe(2)
    expect(buildRecoveryWorkoutPrompt({
      splitKey: 'push', logDate: '2026-09-30', today: '2026-10-03',
      yesterday: '2026-10-02', twoDaysAgo: '2026-10-01', nextSplitKey: 'pull',
    })).toBeNull()
  })

  it('only gives the approved follow-up for very sore same-group training', () => {
    const workout = buildRecoveryWorkoutPrompt({
      splitKey: 'legs', logDate: '2026-10-02', today: '2026-10-03',
      yesterday: '2026-10-02', twoDaysAgo: '2026-10-01', nextSplitKey: 'legs',
    })
    expect(recoveryFollowUp(workout, 1)).toBe('今天还是练大腿、臀，热身时多做一组轻的，先感受一下状态。')
    expect(recoveryFollowUp(workout, 3)).toBeNull()
  })
})
