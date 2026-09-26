import type { SupabaseClient } from '@supabase/supabase-js'
import { computeRecoveryTrend, type RecoveryTrend } from '../recovery'
import { loadRecoveryRange } from '../recovery-persistence'
import { resolveNutrientTargets } from './persistence'
import { rollingAverage, computeTrend, type SeriesPoint, type TrendResult } from './trend'
import { computeSessionFacts } from '../workout/session-facts'

/**
 * Pawside — Weekly Log aggregate (Product §22–§24).
 *
 * Product §22: a Weekly Log is NOT seven Daily Reviews concatenated. It exists
 * to show what a single day cannot: the trend across the week.
 *
 * Product §23.1: metrics are shown only when the data can actually support them.
 * `muscle-group volume` and `Method adherence` are deliberately NOT produced
 * here — reliable mappings/rules for those do not exist yet, and inventing them
 * would be exactly the "伪造指标" the Patch forbids. They are recorded as gaps.
 *
 * AI Patch §29.1: every trend is classified here by code. The AI receives the
 * classification and may only explain it.
 */

export interface WeeklyDayCell {
  date: string
  workout_count: number
  duration_minutes: number
  /**
   * Whether any food was logged that day. A day with no log is NOT a 0 kcal
   * day, and must not be averaged as one (Guardrail §12, Product §5.2).
   */
  nutrition_logged: boolean
  /** null when nothing was logged that day — never coerced to 0. */
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  /** null = no weigh-in that day, which is NOT the same as 0. */
  weight_kg: number | null
}

export interface WeeklyAggregate {
  week_start: string
  week_end: string
  training: {
    workout_count: number
    total_duration_minutes: number
    /** Distinct split/session types logged this week. */
    types: string[]
    /** Summed from the persisted exercise sets; null when not recorded. */
    total_completed_sets: number | null
    total_volume_kg: number | null
    duration_trend: TrendResult
    /** Product §23.1: explicitly unavailable rather than faked. */
    unavailable_metrics: string[]
  }
  nutrition: {
    days_logged: number
    calories: { series: SeriesPoint[]; trend: TrendResult }
    protein: { series: SeriesPoint[]; trend: TrendResult }
    carbs: { series: SeriesPoint[]; trend: TrendResult }
    fat: { series: SeriesPoint[]; trend: TrendResult }
    /**
     * Product §23.2 allows below/above reference day counts only when the
     * Evidence Engine supports it. It does not yet, so this stays null.
     */
    days_below_reference: number | null
    days_above_reference: number | null
    target: { calories_kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }
  }
  body: {
    weight_series: SeriesPoint[]
    /** Product §21: the rolling mean is the comparison base, not a single day. */
    weight_rolling_7d: SeriesPoint[]
    weight_trend: TrendResult
  }
  recovery: RecoveryTrend
  days: WeeklyDayCell[]
}

function weekDates(weekStart: string): string[] {
  const base = new Date(`${weekStart}T00:00:00Z`)
  return Array.from({ length: 7 }, (_unused, index) => {
    const day = new Date(base)
    day.setUTCDate(day.getUTCDate() + index)
    return day.toISOString().slice(0, 10)
  })
}

export async function buildWeeklyAggregate(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<WeeklyAggregate> {
  const dates = weekDates(weekStart)
  const weekEnd = dates[dates.length - 1]

  const [workoutResult, summaryResult, metricResult, recoveryCheckins, target] = await Promise.all([
    supabase
      .from('workout_logs')
      .select('date,duration_minutes,type,exercises')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd),
    // Canonical day totals, not the legacy JSONB.
    supabase
      .from('daily_nutrition_summary')
      .select('log_date,total_energy_kcal,total_protein_g,total_carb_g,total_fat_g,meal_count,energy_data_status,protein_data_status,carb_data_status,fat_data_status')
      .eq('user_id', userId)
      .gte('log_date', weekStart)
      .lte('log_date', weekEnd),
    supabase
      .from('body_metrics')
      .select('date,weight_kg')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd),
    loadRecoveryRange(supabase, userId, weekStart, weekEnd),
    resolveNutrientTargets(supabase, userId, weekEnd),
  ])

  const workouts = workoutResult.data ?? []
  const summaries = summaryResult.data ?? []
  const metrics = metricResult.data ?? []

  const summaryByDate = new Map(
    summaries.map((row) => [row.log_date as string, row]),
  )
  const weightByDate = new Map(
    metrics
      .filter((row) => row.weight_kg !== null)
      .map((row) => [row.date as string, Number(row.weight_kg)]),
  )

  const days: WeeklyDayCell[] = dates.map((date) => {
    const dayWorkouts = workouts.filter((row) => row.date === date)
    const summary = summaryByDate.get(date)
    // A summary row can exist with meal_count 0; treat that as not logged.
    const logged = Boolean(summary) && Number(summary?.meal_count ?? 0) > 0
    return {
      date,
      workout_count: dayWorkouts.length,
      duration_minutes: dayWorkouts.reduce(
        (sum, row) => sum + (row.duration_minutes === null ? 0 : Number(row.duration_minutes)),
        0,
      ),
      nutrition_logged: logged,
      // Guardrail §12: an unlogged day stays null, so it is excluded from
      // trend maths rather than dragging the average toward zero.
      calories_kcal: logged && summary?.energy_data_status === 'complete'
        ? Number(summary.total_energy_kcal)
        : null,
      protein_g: logged && summary?.protein_data_status === 'complete'
        ? Number(summary.total_protein_g)
        : null,
      carbs_g: logged && summary?.carb_data_status === 'complete'
        ? Number(summary.total_carb_g)
        : null,
      fat_g: logged && summary?.fat_data_status === 'complete'
        ? Number(summary.total_fat_g)
        : null,
      // Absent weigh-in stays null: not a 0 kg day.
      weight_kg: weightByDate.get(date) ?? null,
    }
  })

  // Aggregate set/volume facts from the persisted exercise rows.
  let totalSets: number | null = null
  let totalVolume: number | null = null
  for (const workout of workouts) {
    const facts = computeSessionFacts({
      exercises: workout.exercises,
      durationMinutes: workout.duration_minutes === null ? null : Number(workout.duration_minutes),
    })
    if (facts.completed_set_count !== null) {
      totalSets = (totalSets ?? 0) + facts.completed_set_count
    }
    if (facts.total_volume_kg !== null) {
      totalVolume = (totalVolume ?? 0) + facts.total_volume_kg
    }
  }

  const durationSeries: SeriesPoint[] = days.map((day) => ({
    date: day.date,
    // A rest day is a real 0 minutes of training, unlike a missing weigh-in.
    value: day.duration_minutes,
  }))

  const caloriesSeries: SeriesPoint[] = days.map((day) => ({
    date: day.date,
    value: day.calories_kcal,
  }))
  const proteinSeries: SeriesPoint[] = days.map((day) => ({ date: day.date, value: day.protein_g }))
  const carbsSeries: SeriesPoint[] = days.map((day) => ({ date: day.date, value: day.carbs_g }))
  const fatSeries: SeriesPoint[] = days.map((day) => ({ date: day.date, value: day.fat_g }))

  const weightSeries: SeriesPoint[] = days.map((day) => ({
    date: day.date,
    value: day.weight_kg,
  }))

  return {
    week_start: weekStart,
    week_end: weekEnd,
    training: {
      workout_count: workouts.length,
      total_duration_minutes: days.reduce((sum, day) => sum + day.duration_minutes, 0),
      types: [...new Set(workouts.map((row) => row.type as string))],
      total_completed_sets: totalSets,
      total_volume_kg: totalVolume,
      duration_trend: computeTrend(durationSeries, 'week'),
      // Product §23.1: state the gap instead of filling the dashboard.
      unavailable_metrics: ['muscle_group_volume', 'method_adherence'],
    },
    nutrition: {
      days_logged: days.filter((day) => day.nutrition_logged).length,
      calories: { series: caloriesSeries, trend: computeTrend(caloriesSeries, 'week') },
      protein: { series: proteinSeries, trend: computeTrend(proteinSeries, 'week') },
      carbs: { series: carbsSeries, trend: computeTrend(carbsSeries, 'week') },
      fat: { series: fatSeries, trend: computeTrend(fatSeries, 'week') },
      // Product §23.2 gates these on the Evidence Engine, which does not exist yet.
      days_below_reference: null,
      days_above_reference: null,
      target,
    },
    body: {
      weight_series: weightSeries,
      weight_rolling_7d: rollingAverage(weightSeries, 7),
      weight_trend: computeTrend(rollingAverage(weightSeries, 7), 'rolling_7d'),
    },
    recovery: computeRecoveryTrend(recoveryCheckins),
    days,
  }
}
