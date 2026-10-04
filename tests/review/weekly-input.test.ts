import { describe, expect, it } from 'vitest'
import { buildWeeklyReviewInput } from '../../lib/nutrition/weekly-review'

const trend = {
  direction: 'stable', point_count: 4, mean: 10, change: 0,
  basis: { method: 'first_last_with_volatility', stable_band: 0.02, volatility_band: 0.05, window: 'week' },
  authority: 'AI Patch §29.1',
} as const

describe('weekly review input', () => {
  it('does not expose training duration to the AI context', () => {
    const aggregate = {
      week_start: '2026-09-28', week_end: '2026-10-04',
      training: { workout_count: 3, total_duration_minutes: 180, types: ['胸'], total_completed_sets: 12, total_volume_kg: 2000, duration_trend: trend, unavailable_metrics: [] },
      nutrition: {
        calories: { trend }, protein: { trend }, carbs: { trend }, fat: { trend },
        days_logged: 5, target: null, days_below_reference: 0, days_above_reference: 0,
      },
      body: { weight_trend: trend, weight_rolling_7d: [] },
      recovery: { average_sleep: null, average_post_workout_recovery: null, answered_days: 0, total_days: 7 },
    }
    const input = buildWeeklyReviewInput(aggregate as never)
    expect(JSON.stringify(input)).not.toContain('duration')
    expect(input.computed_trends.map((item) => item.metric_key)).not.toContain('training.duration')
  })
})
