import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftDateKey } from '../utils'
import { getDayFacts } from './day-facts'

/**
 * What 小爪 "knows about you" when it answers a question: a small, server-built
 * summary so replies can be personal ("你在减脂期，今天已经练过了") instead of generic.
 *
 * Privacy rules (docs/coach/proposals/14 §11):
 *  - Only coarse facts: goal type, whether a calorie target is set, what was logged
 *    today (food and workout NAMES), how many days trained in the last 7, and the
 *    direction of the weight trend. No age, sex, height, raw weights or calorie numbers.
 *  - Never smart-ring / wearable data (see CLAUDE.md; tests/devices/no-ai.test.ts
 *    scans this folder).
 *  - Best effort: any read failure returns null and the turn runs without it.
 */

export type GoalKind = 'gain_muscle' | 'lose_fat' | 'maintain'
export type WeightTrend = 'down' | 'up' | 'flat' | 'unknown'

export interface UserContext {
  goal: GoalKind | null
  has_calorie_target: boolean
  weekly_workout_target: number | null
  today_meals: Array<{ meal: string; foods: string[] }>
  today_workouts: string[]
  workout_days_last_7: number
  weight_trend_14d: WeightTrend
}

const GOALS: GoalKind[] = ['gain_muscle', 'lose_fat', 'maintain']
const MEAL_LABEL: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }

/**
 * Direction of the weight trend from up to 14 days of weigh-ins: mean of the older
 * half vs the newer half. Needs 3+ weigh-ins spread over 5+ days; under 0.3 kg is "flat".
 * A direction only, never a judgement (E-BODY-002).
 */
export function weightTrend(points: Array<{ date: string; kg: number }>): WeightTrend {
  const sorted = points.filter((p) => Number.isFinite(p.kg) && p.kg > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 3) return 'unknown'
  const first = Date.parse(`${sorted[0].date}T00:00:00Z`)
  const last = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`)
  if ((last - first) / 86_400_000 < 4) return 'unknown'
  const half = Math.floor(sorted.length / 2)
  const mean = (list: typeof sorted) => list.reduce((sum, p) => sum + p.kg, 0) / list.length
  const delta = mean(sorted.slice(sorted.length - half)) - mean(sorted.slice(0, half))
  if (Math.abs(delta) < 0.3) return 'flat'
  return delta < 0 ? 'down' : 'up'
}

export async function loadUserContext(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<UserContext | null> {
  try {
    const weekAgo = shiftDateKey(today, -6)
    const twoWeeksAgo = shiftDateKey(today, -13)
    const [profile, facts, workouts, weights] = await Promise.all([
      supabase.from('user_profiles').select('goal,daily_calorie_target,weekly_workout_target').eq('id', userId).maybeSingle(),
      getDayFacts(supabase, userId, today, ['meals', 'workouts']),
      supabase.from('workout_logs').select('date').eq('user_id', userId).gte('date', weekAgo).lte('date', today),
      supabase.from('body_metrics').select('date,weight_kg').eq('user_id', userId).gte('date', twoWeeksAgo).lte('date', today),
    ])
    if (profile.error || workouts.error || weights.error) return null

    const goal = GOALS.includes(profile.data?.goal as GoalKind) ? (profile.data?.goal as GoalKind) : null
    const target = profile.data?.weekly_workout_target
    return {
      goal,
      has_calorie_target: profile.data?.daily_calorie_target != null,
      weekly_workout_target: typeof target === 'number' && target > 0 ? target : null,
      today_meals: facts.meals.slice(0, 5).map((meal) => ({
        meal: MEAL_LABEL[meal.meal_type] ?? '其他',
        foods: meal.items.slice(0, 6).map((item) => item.name.slice(0, 20)),
      })),
      today_workouts: facts.workouts.slice(0, 4).map((workout) => workout.type.slice(0, 20)),
      workout_days_last_7: new Set((workouts.data ?? []).map((row) => String(row.date))).size,
      weight_trend_14d: weightTrend((weights.data ?? [])
        .filter((row) => row.weight_kg != null)
        .map((row) => ({ date: String(row.date), kg: Number(row.weight_kg) }))),
    }
  } catch (error) {
    console.error('[coach-chat] user context unavailable', error instanceof Error ? error.message : 'unknown')
    return null
  }
}
