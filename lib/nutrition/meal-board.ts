import type { SupabaseClient } from '@supabase/supabase-js'
import { summarizeMeal, MEAL_LABELS, type MealContext } from '../coach/meal-context'
import { loadDayItemRows, type MealType } from './persistence'
import type { NutrientTargets } from './types'

/**
 * Patch B · B1 — "今日餐单": one row per meal_type (breakfast/lunch/dinner/
 * snack), every save of that meal_type that day already merged into it. This
 * is the same merge `lib/coach/meal-context.ts#loadMealContext` does for one
 * meal at a time; here all four are built from a single query so the food
 * page can render the whole day in one request.
 */

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export interface MealBoardItem {
  name: string
  weight_g: number | null
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

export type MealBoardEntry = MealContext & { items: MealBoardItem[] }
export type MealBoard = Record<MealType, MealBoardEntry>

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}

function emptyMeal(mealType: MealType): MealBoardEntry {
  return {
    meal_type: mealType,
    meal_label: MEAL_LABELS[mealType],
    save_count: 0,
    item_names: [],
    totals: { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null },
    meal_ref: null,
    position: null,
    has_estimated_items: false,
    items: [],
  }
}

export async function buildMealBoard(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  target: NutrientTargets,
): Promise<MealBoard> {
  const rows = await loadDayItemRows(supabase, userId, date)

  const byMeal = new Map<MealType, typeof rows>()
  const savesByMeal = new Map<MealType, Set<string>>()
  for (const row of rows) {
    const bucket = byMeal.get(row.meal_type) ?? []
    bucket.push(row)
    byMeal.set(row.meal_type, bucket)
    const saves = savesByMeal.get(row.meal_type) ?? new Set<string>()
    saves.add(row.food_log_id)
    savesByMeal.set(row.meal_type, saves)
  }

  const board = {} as MealBoard
  for (const mealType of MEAL_ORDER) {
    const items = byMeal.get(mealType)
    board[mealType] = items
      ? {
        ...summarizeMeal({
        mealType,
        saveCount: savesByMeal.get(mealType)?.size ?? 0,
        items: items.map((item) => ({ ...item, is_estimated: item.is_estimated ?? null })),
        target,
        }),
        items: items.map((item) => ({
          name: (item.food_name_resolved || item.food_name_raw || '未命名食物').trim(),
          weight_g: finiteOrNull(item.weight_g),
          calories_kcal: finiteOrNull(item.energy_kcal),
          protein_g: finiteOrNull(item.protein_g),
          carbs_g: finiteOrNull(item.carb_g),
          fat_g: finiteOrNull(item.fat_g),
        })),
      }
      : emptyMeal(mealType)
  }
  return board
}
