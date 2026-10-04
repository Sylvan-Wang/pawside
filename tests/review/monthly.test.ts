import { describe, expect, it } from 'vitest'
import { buildMonthlyAggregate, buildMonthlyReviewInput } from '../../lib/review/monthly'
import type { WeeklyAggregate } from '../../lib/nutrition/weekly-log'

function week(): WeeklyAggregate {
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    workout_count: index < 3 ? 1 : 0,
    duration_minutes: 60,
    nutrition_logged: index < 5,
    calories_kcal: index < 5 ? 1800 + index * 10 : null,
    protein_g: index < 5 ? 100 + index : null,
    carbs_g: index < 5 ? 200 + index : null,
    fat_g: index < 5 ? 60 + index : null,
    weight_kg: index < 4 ? 70 + index / 10 : null,
  }))
  const trend = { direction: 'stable', point_count: 5, mean: 1, change: 0, basis: { method: 'first_last_with_volatility', stable_band: 0.02, volatility_band: 0.05, window: 'week' }, authority: 'AI Patch §29.1' } as const
  return {
    week_start: '2026-08-31', week_end: '2026-09-06', days,
    training: { workout_count: 3, total_duration_minutes: 180, types: ['胸'], total_completed_sets: 12, total_volume_kg: 2000, duration_trend: trend, unavailable_metrics: ['method_adherence'] },
    nutrition: { days_logged: 5, calories: { series: [], trend }, protein: { series: [], trend }, carbs: { series: [], trend }, fat: { series: [], trend }, days_below_reference: null, days_above_reference: null, target: { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null } },
    body: { weight_series: [], weight_rolling_7d: [], weight_trend: trend },
    recovery: { average_sleep: 3, average_post_workout_recovery: 4, answered_days: 4, total_days: 7 },
  }
}

describe('buildMonthlyAggregate', () => {
  it('aggregates deterministic facts without exposing training duration', () => {
    const aggregate = buildMonthlyAggregate([week()], '2026-09-01')
    expect(aggregate.record_days).toBe(5)
    expect(aggregate.training.workout_count).toBe(3)
    expect(aggregate.training).not.toHaveProperty('total_duration_minutes')
    expect(JSON.stringify(buildMonthlyReviewInput(aggregate))).not.toContain('duration')
  })
})
