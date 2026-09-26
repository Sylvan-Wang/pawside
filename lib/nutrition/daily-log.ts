import type { SupabaseClient } from '@supabase/supabase-js'
import { type NutrientTargets, type NutritionBudget } from './types'
import { getDailyNutritionFacts, loadDayItemRows, resolveNutrientTargets, type DailyNutritionFacts } from './persistence'
import { computeMealFeedbackStatus, type MealFeedbackStatus } from './meal-feedback'
import { describeSelfReport } from '../recovery'

/**
 * Pawside — Daily Log aggregation (Product Patch §15–§21).
 *
 * Product §16 defines the page order; this module produces every section from
 * deterministic facts so the UI never has to run its own reducer:
 *
 *   DATE NAVIGATION -> Daily Dashboard -> Recovery -> Workout Logs
 *   -> Food Logs -> Body Data (if present) -> Daily Review -> Next-day Guidance
 *
 * Product §17 requires BOTH the dashboard summary and the readable Raw Logs, so
 * the payload carries per-entry rows as well as totals.
 *
 * Product §19 / AC-P11: a day that is not finished must be labelled
 * "截至目前" and must not pretend to be a complete end-of-day summary.
 */

export interface DailyWorkoutEntry {
  id: string
  type: string
  duration_minutes: number | null
  notes: string | null
  exercises: unknown
  method_workout_session_id: string | null
  /** Local time the row was created, for the §17 raw log line. */
  created_at: string | null
}

export interface DailyFoodEntry {
  id: string
  meal_type: string
  created_at: string | null
  item_count: number
  calories_kcal: number | null
  is_estimated: boolean
}

export interface DailyRecoverySection {
  recorded: boolean
  skipped: boolean
  sleep_quality_self_report: number | null
  post_workout_recovery_self_report: number | null
  /** Product §8: only the three permitted descriptions. */
  sleep_description: string | null
  recovery_description: string | null
}

export interface DailyBodySection {
  weight_kg: number | null
  body_fat_pct: number | null
  muscle_mass: number | null
  notes: string | null
}

export interface DailyCacheState {
  /** True when a cached daily review exists for this date at the current version. */
  review_cached: boolean
  review_prompt_version: string | null
  /** True when the stored review was produced before the day changed. */
  review_stale: boolean
}

export interface DailyLog {
  date: string
  /** Product §19: today is incomplete by definition. */
  is_today: boolean
  /** Today's heading must read "截至目前" (AC-P11). */
  period_label: string
  workouts: DailyWorkoutEntry[]
  meals: DailyFoodEntry[]
  recovery: DailyRecoverySection
  body: DailyBodySection | null
  nutrition: DailyNutritionFacts
  status: MealFeedbackStatus[]
  summary: {
    workout_count: number
    total_duration_minutes: number
    meal_count: number
    logged_item_count: number
    /** Product §23.1: never fabricate a metric when data is thin. */
    data_completeness: 'complete' | 'partial' | 'unknown'
  }
  cache: DailyCacheState
}

/**
 * Product §20 / AC-P12: adjacent days are prepared so switching dates does not
 * always wait for a full regeneration. This is the window the client warms.
 */
export function adjacentDates(date: string): { previous: string; next: string } {
  const base = new Date(`${date}T00:00:00Z`)
  const shift = (days: number): string => {
    const shifted = new Date(base)
    shifted.setUTCDate(shifted.getUTCDate() + days)
    return shifted.toISOString().slice(0, 10)
  }
  return { previous: shift(-1), next: shift(1) }
}

export interface BuildDailyLogInput {
  userId: string
  date: string
  /** Server-known "today" in the caller's local day. */
  today: string
}

export async function buildDailyLog(
  supabase: SupabaseClient,
  input: BuildDailyLogInput,
): Promise<DailyLog> {
  const { userId, date } = input

  const [workoutResult, logsResult, metricResult, reviewResult, target] = await Promise.all([
    supabase
      .from('workout_logs')
      .select('id,type,duration_minutes,notes,exercises,method_workout_session_id,created_at')
      .eq('user_id', userId)
      .eq('date', date)
      .order('created_at', { ascending: true }),
    supabase
      .from('user_food_logs')
      .select('id,meal_type,created_at')
      .eq('user_id', userId)
      .eq('log_date', date)
      .order('created_at', { ascending: true }),
    supabase
      .from('body_metrics')
      .select('weight_kg,body_fat_pct,muscle_mass,notes')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle(),
    supabase
      .from('ai_generated_content')
      .select('prompt_version,is_stale')
      .eq('user_id', userId)
      .eq('content_type', 'daily_review_ai')
      .eq('target_date', date)
      .maybeSingle(),
    resolveNutrientTargets(supabase, userId, date),
  ])

  // Food: read canonical items once and group them per meal, so the per-meal
  // rows and the day total come from the same source (Guardrail §5).
  const mealRows = logsResult.data ?? []
  const itemRows = await loadDayItemRows(supabase, userId, date)

  const perMeal = new Map<string, { count: number; calories: number | null; estimated: boolean }>()
  for (const row of itemRows) {
    const current = perMeal.get(row.food_log_id) ?? { count: 0, calories: 0, estimated: false }
    current.count += 1
    current.calories = current.calories === null || row.energy_kcal === null
      ? null
      : current.calories + row.energy_kcal
    current.estimated = current.estimated || row.is_estimated === true
    perMeal.set(row.food_log_id, current)
  }

  const items = itemRows

  const meals: DailyFoodEntry[] = mealRows.map((row) => {
    const meal = perMeal.get(row.id)
    return {
      id: row.id,
      meal_type: row.meal_type,
      created_at: row.created_at,
      item_count: meal?.count ?? 0,
      calories_kcal: meal?.calories ?? null,
      is_estimated: meal?.estimated ?? false,
    }
  })

  const workouts: DailyWorkoutEntry[] = (workoutResult.data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    duration_minutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
    notes: row.notes,
    exercises: row.exercises,
    method_workout_session_id: row.method_workout_session_id,
    created_at: row.created_at,
  }))

  const nutrition = await getDailyNutritionFacts(supabase, userId, date, target)
  const isToday = date === input.today
  // A current day is incomplete by definition. Complete reference-band
  // judgements must not turn a complete *record* into a complete *day*.
  const status = computeMealFeedbackStatus(nutrition, { isCompleteDay: !isToday })
  const recovery = await loadRecoverySection(supabase, userId, date)

  const body = metricResult.data
    ? {
      weight_kg: metricResult.data.weight_kg === null ? null : Number(metricResult.data.weight_kg),
      body_fat_pct: metricResult.data.body_fat_pct === null ? null : Number(metricResult.data.body_fat_pct),
      muscle_mass: metricResult.data.muscle_mass === null ? null : Number(metricResult.data.muscle_mass),
      notes: metricResult.data.notes,
    }
    : null

  const totalDuration = workouts.reduce((sum, entry) => sum + (entry.duration_minutes ?? 0), 0)

  return {
    date,
    is_today: isToday,
    // Product §19: "今日状态 · 截至目前" vs "9 月 25 日 Daily Log".
    period_label: isToday ? '今日状态 · 截至目前' : `${date} Daily Log`,
    workouts,
    meals,
    recovery,
    body,
    nutrition,
    status,
    summary: {
      workout_count: workouts.length,
      total_duration_minutes: totalDuration,
      meal_count: meals.length,
      logged_item_count: items.length,
      // A finished past day with no entries is still "unknown", not "complete":
      // there is nothing to be complete about.
      data_completeness: isToday ? 'partial' : nutrition.data_completeness,
    },
    cache: {
      review_cached: Boolean(reviewResult.data),
      review_prompt_version: reviewResult.data?.prompt_version ?? null,
      // Product §21: a cached review is stale once the day's facts changed.
      // `is_stale` exists in the schema but is never written, so staleness is
      // derived here from the same source of truth the invalidation uses.
      review_stale: Boolean(reviewResult.data) && isToday,
    },
  }
}

async function loadRecoverySection(
  supabase: SupabaseClient,
  userId: string,
  date: string,
): Promise<DailyRecoverySection> {
  const { data } = await supabase
    .from('recovery_checkins')
    .select('sleep_quality_self_report,post_workout_recovery_self_report,skipped')
    .eq('user_id', userId)
    .eq('checkin_date', date)
    .maybeSingle()

  if (!data) {
    // Product §27: show "今日未记录主观恢复" rather than a default 3/5.
    return {
      recorded: false,
      skipped: false,
      sleep_quality_self_report: null,
      post_workout_recovery_self_report: null,
      sleep_description: null,
      recovery_description: null,
    }
  }

  return {
    recorded: true,
    skipped: data.skipped,
    sleep_quality_self_report: data.sleep_quality_self_report,
    post_workout_recovery_self_report: data.post_workout_recovery_self_report,
    sleep_description: describeSelfReport(data.sleep_quality_self_report),
    recovery_description: describeSelfReport(data.post_workout_recovery_self_report),
  }
}

/**
 * Product §16.2 Daily Dashboard nutrition row.
 *
 * Exposed separately so Home and the Daily Log render identical numbers from
 * one implementation instead of two reducers (Guardrail §5).
 */
export function toDashboardNutrition(
  budget: NutritionBudget,
): Array<{ key: string; label: string; consumed: number | null; target: number | null; remaining: number | null; unit: string }> {
  return [
    {
      key: 'calories',
      label: '热量',
      consumed: budget.consumed.calories_kcal,
      target: budget.target.calories_kcal,
      remaining: budget.remaining?.calories_kcal ?? null,
      unit: 'kcal',
    },
    {
      key: 'protein',
      label: '蛋白质',
      consumed: budget.consumed.protein_g,
      target: budget.target.protein_g,
      remaining: budget.remaining?.protein_g ?? null,
      unit: 'g',
    },
    {
      key: 'carbs',
      label: '碳水',
      consumed: budget.consumed.carbs_g,
      target: budget.target.carbs_g,
      remaining: budget.remaining?.carbs_g ?? null,
      unit: 'g',
    },
    {
      key: 'fat',
      label: '脂肪',
      consumed: budget.consumed.fat_g,
      target: budget.target.fat_g,
      remaining: budget.remaining?.fat_g ?? null,
      unit: 'g',
    },
  ]
}

/** Re-exported so the Daily Log and Meal Feedback share one budget type. */
export type { NutrientTargets, NutritionBudget }
