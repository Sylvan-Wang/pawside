import type { SupabaseClient } from '@supabase/supabase-js'
import { buildMealCalorieRanges } from '../nutrition/guidance'
import type { MealType } from '../nutrition/persistence'
import type { NutrientTargets } from '../nutrition/types'

/**
 * Pawside Coach — "this meal" for meal feedback (prompt v2).
 *
 * Every save creates its own user_food_logs row, so a meal saved in two steps
 * (rice first, 可乐鸡翅 ten minutes later) used to be judged as two meals. Here
 * the meal is ALL rows of the same log_date + meal_type, summed.
 *
 * The reference range comes only from lib/nutrition/guidance.ts
 * (breakfast 25–30%, lunch 30–40%, dinner 30–35% of the daily target). Snacks
 * have no range. The range is guidance, never a budget.
 */

export interface MealTotals {
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

export interface MealContext {
  meal_type: MealType
  meal_label: string
  save_count: number
  item_names: string[]
  totals: MealTotals
  /** Reference range for this meal; null for snacks or without a calorie target. */
  meal_ref: { calories_kcal: [number, number] } | null
  /** Where this meal lands against its range. */
  position: 'below' | 'within' | 'above' | null
  has_estimated_items: boolean
}

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

interface ItemRow {
  food_name_raw: string | null
  food_name_resolved: string | null
  is_estimated: boolean | null
  energy_kcal: number | string | null
  protein_g: number | string | null
  carb_g: number | string | null
  fat_g: number | string | null
}

function sum(values: Array<number | string | null>): number | null {
  let total = 0
  let any = false
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) continue
    total += numeric
    any = true
  }
  return any ? total : null
}

/** Pure part, exported for tests. */
export function summarizeMeal(input: {
  mealType: MealType
  saveCount: number
  items: ItemRow[]
  target: NutrientTargets
}): MealContext {
  const totals: MealTotals = {
    calories_kcal: sum(input.items.map((item) => item.energy_kcal)),
    protein_g: sum(input.items.map((item) => item.protein_g)),
    carbs_g: sum(input.items.map((item) => item.carb_g)),
    fat_g: sum(input.items.map((item) => item.fat_g)),
  }
  const ranges = buildMealCalorieRanges(input.target.calories_kcal)
  const range = input.mealType === 'snack' || !ranges ? null : ranges[input.mealType]

  let position: MealContext['position'] = null
  if (range && totals.calories_kcal !== null) {
    position = totals.calories_kcal < range[0] ? 'below' : totals.calories_kcal > range[1] ? 'above' : 'within'
  }

  const names = input.items
    .map((item) => (item.food_name_resolved || item.food_name_raw || '').trim())
    .filter(Boolean)

  return {
    meal_type: input.mealType,
    meal_label: MEAL_LABELS[input.mealType],
    save_count: input.saveCount,
    item_names: [...new Set(names)].slice(0, 12),
    totals,
    meal_ref: range ? { calories_kcal: range } : null,
    position,
    has_estimated_items: input.items.some((item) => item.is_estimated === true),
  }
}

export async function loadMealContext(
  supabase: SupabaseClient,
  input: { userId: string; date: string; mealType: MealType; target: NutrientTargets },
): Promise<MealContext | null> {
  try {
    const { data: logs, error } = await supabase
      .from('user_food_logs')
      .select('id')
      .eq('user_id', input.userId)
      .eq('log_date', input.date)
      .eq('meal_type', input.mealType)
    if (error || !logs || logs.length === 0) return null

    const { data: items, error: itemsError } = await supabase
      .from('user_food_log_items')
      .select('food_name_raw,food_name_resolved,is_estimated,energy_kcal,protein_g,carb_g,fat_g')
      .in('food_log_id', logs.map((row) => row.id as string))
      .neq('status', 'rejected')
    if (itemsError || !items) return null

    return summarizeMeal({
      mealType: input.mealType,
      saveCount: logs.length,
      items: items as ItemRow[],
      target: input.target,
    })
  } catch {
    return null
  }
}

/** Numbers the meal context introduces (range bounds, meal totals). */
export function mealContextNumbers(context: MealContext | null): number[] {
  if (!context) return []
  const numbers: number[] = []
  for (const value of Object.values(context.totals)) if (value !== null) numbers.push(value)
  if (context.meal_ref) numbers.push(...context.meal_ref.calories_kcal)
  return numbers
}
