import { describeTrend, type TrendResult } from './trend'
import type { WeeklyAggregate } from './weekly-log'

/**
 * Pawside — Weekly Review AI input contract (Product §24, AI Patch §29).
 *
 * Product §24 lists the output slots; AI Patch §29 defines what the model is
 * allowed to receive:
 *
 *   "Weekly Review 不是 summarize(daily_review_1 ... daily_review_7)"
 *   "先由代码检测 increasing / decreasing / stable / insufficient / volatile
 *    AI 再解释。AI 不能自己肉眼估趋势后给数字。"
 *
 * The contract therefore ships the trend CLASSIFICATION, never the raw series,
 * so the model has nothing to eyeball. Built in one place so a future caller
 * cannot hand the model raw logs and ask it to find the trend itself.
 */

export const WEEKLY_REVIEW_SLOTS = [
  '本周发生了什么',
  '最明显的趋势',
  '值得注意的问题',
  '下周建议',
] as const

export type WeeklyReviewSlot = (typeof WEEKLY_REVIEW_SLOTS)[number]

export interface WeeklyReviewInputContract {
  week_start: string
  week_end: string
  /** Deterministic classifications — the model explains, it does not decide. */
  computed_trends: Array<{
    metric_key: string
    direction: TrendResult['direction']
    /** The exact sentence the direction permits, or the insufficient-data line. */
    description: string | null
    point_count: number
    mean: number | null
    basis: TrendResult['basis']
    authority: string
  }>
  training_summary: Record<string, unknown>
  nutrition_summary: Record<string, unknown>
  body_summary: Record<string, unknown>
  recovery_summary: Record<string, unknown>
  /** Product §23.1: metrics that must NOT be claimed this week. */
  unavailable_metrics: string[]
  output_slots: readonly string[]
}

export function buildWeeklyReviewInput(
  aggregate: WeeklyAggregate,
): WeeklyReviewInputContract {
  const trendEntries: Array<[string, string, TrendResult]> = [
    ['training.duration', '训练时长', aggregate.training.duration_trend],
    ['nutrition.calories', '热量摄入', aggregate.nutrition.calories.trend],
    ['nutrition.protein', '蛋白质摄入', aggregate.nutrition.protein.trend],
    ['nutrition.carbs', '碳水摄入', aggregate.nutrition.carbs.trend],
    ['nutrition.fat', '脂肪摄入', aggregate.nutrition.fat.trend],
    ['body.weight', '体重', aggregate.body.weight_trend],
  ]

  const latestRollingWeight = [...aggregate.body.weight_rolling_7d]
    .reverse()
    .find((point) => point.value !== null)?.value ?? null

  return {
    week_start: aggregate.week_start,
    week_end: aggregate.week_end,
    computed_trends: trendEntries.map(([metricKey, subject, trend]) => ({
      metric_key: metricKey,
      direction: trend.direction,
      // Product §27: an `insufficient` trend yields the "not enough data" line,
      // which the model must pass through rather than replace.
      description: describeTrend(trend.direction, subject),
      point_count: trend.point_count,
      mean: trend.mean,
      basis: trend.basis,
      authority: trend.authority,
    })),
    training_summary: {
      workout_count: aggregate.training.workout_count,
      total_duration_minutes: aggregate.training.total_duration_minutes,
      types: aggregate.training.types,
      total_completed_sets: aggregate.training.total_completed_sets,
      total_volume_kg: aggregate.training.total_volume_kg,
    },
    nutrition_summary: {
      days_logged: aggregate.nutrition.days_logged,
      target: aggregate.nutrition.target,
      days_below_reference: aggregate.nutrition.days_below_reference,
      days_above_reference: aggregate.nutrition.days_above_reference,
    },
    body_summary: {
      weight_trend_direction: aggregate.body.weight_trend.direction,
      // Product §21: the rolling mean is the reference, never a single day.
      weight_rolling_7d_latest: latestRollingWeight,
    },
    recovery_summary: {
      average_sleep: aggregate.recovery.average_sleep,
      average_post_workout_recovery: aggregate.recovery.average_post_workout_recovery,
      answered_days: aggregate.recovery.answered_days,
      total_days: aggregate.recovery.total_days,
    },
    unavailable_metrics: aggregate.training.unavailable_metrics,
    output_slots: WEEKLY_REVIEW_SLOTS,
  }
}
