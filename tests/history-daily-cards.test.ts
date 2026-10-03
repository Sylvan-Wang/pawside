import { describe, expect, it } from 'vitest'
import { comparisonLabel } from '../lib/history/daily-workout-card'

describe('daily workout card comparisons', () => {
  it('prefers a weight increase', () => {
    expect(comparisonLabel(
      { top_weight_kg: 30, reps: 8 },
      { top_weight_kg: 27.5, reps: 12 },
    )).toBe('↑ 重量 +2.5 kg')
  })

  it('reports added reps only at the same weight', () => {
    expect(comparisonLabel(
      { top_weight_kg: 30, reps: 12 },
      { top_weight_kg: 30, reps: 10 },
    )).toBe('↑ 比上次多 2 次')
    expect(comparisonLabel(
      { top_weight_kg: 29, reps: 15 },
      { top_weight_kg: 30, reps: 10 },
    )).toBeNull()
  })

  it('labels an exercise with no prior execution as the first time', () => {
    expect(comparisonLabel({ top_weight_kg: 20, reps: 10 }, null)).toBe('第一次练')
  })
})
