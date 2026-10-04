import { computeTrend, rollingAverage, type SeriesPoint, type TrendResult } from '../nutrition/trend'
import type { WeeklyAggregate } from '../nutrition/weekly-log'

type NutrientKey = 'calories' | 'protein' | 'carbs' | 'fat'

export interface MonthlyAggregate {
  month_start: string
  month_end: string
  record_days: number
  training: {
    workout_count: number
    types: string[]
    total_completed_sets: number | null
    total_volume_kg: number | null
    unavailable_metrics: string[]
  }
  nutrition: Record<NutrientKey, { series: SeriesPoint[]; trend: TrendResult }> & { days_logged: number }
  body: { weight_rolling_7d: SeriesPoint[]; weight_trend: TrendResult }
  recovery: { average_sleep: number | null; average_post_workout_recovery: number | null; answered_days: number; total_days: number }
}

function endOfMonth(monthStart: string) {
  const date = new Date(`${monthStart}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  date.setUTCDate(0)
  return date.toISOString().slice(0, 10)
}

const present = (values: Array<number | null>) => values.filter((value): value is number => value !== null)
const mean = (values: Array<number | null>) => {
  const usable = present(values)
  return usable.length === 0 ? null : usable.reduce((sum, value) => sum + value, 0) / usable.length
}

/** C2 pure monthly aggregate. Its public training shape deliberately has no duration field. */
export function buildMonthlyAggregate(weeks: WeeklyAggregate[], monthStart: string): MonthlyAggregate {
  const monthEnd = endOfMonth(monthStart)
  const days = weeks.flatMap((week) => week.days).filter((day) => day.date >= monthStart && day.date <= monthEnd)
  const uniqueDays = [...new Map(days.map((day) => [day.date, day])).values()].sort((a, b) => a.date.localeCompare(b.date))
  const nutritionSeries = (key: NutrientKey): SeriesPoint[] => uniqueDays.map((day) => ({
    date: day.date,
    value: key === 'calories' ? day.calories_kcal : day[`${key}_g`],
  }))
  const weight = uniqueDays.map((day) => ({ date: day.date, value: day.weight_kg }))
  const rollingWeight = rollingAverage(weight, 7)
  const answeredWeeks = weeks.filter((week) => week.recovery.answered_days > 0)
  const sumNullable = (values: Array<number | null>) => {
    const usable = present(values)
    return usable.length === 0 ? null : usable.reduce((sum, value) => sum + value, 0)
  }

  return {
    month_start: monthStart,
    month_end: monthEnd,
    record_days: uniqueDays.filter((day) => day.workout_count > 0 || day.nutrition_logged || day.weight_kg !== null).length,
    training: {
      workout_count: uniqueDays.reduce((sum, day) => sum + day.workout_count, 0),
      types: [...new Set(weeks.flatMap((week) => week.training.types))],
      total_completed_sets: sumNullable(weeks.map((week) => week.training.total_completed_sets)),
      total_volume_kg: sumNullable(weeks.map((week) => week.training.total_volume_kg)),
      unavailable_metrics: [...new Set(weeks.flatMap((week) => week.training.unavailable_metrics))],
    },
    nutrition: {
      days_logged: uniqueDays.filter((day) => day.nutrition_logged).length,
      calories: { series: nutritionSeries('calories'), trend: computeTrend(nutritionSeries('calories'), 'month') },
      protein: { series: nutritionSeries('protein'), trend: computeTrend(nutritionSeries('protein'), 'month') },
      carbs: { series: nutritionSeries('carbs'), trend: computeTrend(nutritionSeries('carbs'), 'month') },
      fat: { series: nutritionSeries('fat'), trend: computeTrend(nutritionSeries('fat'), 'month') },
    },
    body: { weight_rolling_7d: rollingWeight, weight_trend: computeTrend(rollingWeight, 'rolling_7d_month') },
    recovery: {
      average_sleep: mean(answeredWeeks.map((week) => week.recovery.average_sleep)),
      average_post_workout_recovery: mean(answeredWeeks.map((week) => week.recovery.average_post_workout_recovery)),
      answered_days: weeks.reduce((sum, week) => sum + week.recovery.answered_days, 0),
      total_days: uniqueDays.length,
    },
  }
}

export function buildMonthlyReviewInput(aggregate: MonthlyAggregate) {
  const entries: Array<[string, TrendResult]> = [
    ['nutrition.calories', aggregate.nutrition.calories.trend],
    ['nutrition.protein', aggregate.nutrition.protein.trend],
    ['nutrition.carbs', aggregate.nutrition.carbs.trend],
    ['nutrition.fat', aggregate.nutrition.fat.trend],
    ['body.weight', aggregate.body.weight_trend],
  ]
  return {
    month_start: aggregate.month_start,
    month_end: aggregate.month_end,
    computed_trends: entries.map(([metric_key, trend]) => ({ metric_key, ...trend })),
    training_summary: aggregate.training,
    nutrition_summary: { days_logged: aggregate.nutrition.days_logged },
    recovery_summary: aggregate.recovery,
    unavailable_metrics: aggregate.training.unavailable_metrics,
  }
}
