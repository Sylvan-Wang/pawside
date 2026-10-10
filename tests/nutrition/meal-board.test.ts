import { describe, expect, it } from 'vitest'
import { buildMealBoard } from '../../lib/nutrition/meal-board.ts'
import type { NutrientTargets } from '../../lib/nutrition/types.ts'

/**
 * Minimal fake covering exactly the two calls `loadDayItemRows` makes:
 *   .from('user_food_logs').select(...).eq(...).eq(...)
 *   .from('user_food_log_items').select(...).in(...).neq(...)
 */
function fakeSupabase(logs: Array<{ id: string; meal_type: string }>, items: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      if (table === 'user_food_logs') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: logs, error: null }),
            }),
          }),
        }
      }
      if (table === 'user_food_log_items') {
        return {
          select: () => ({
            in: () => ({
              neq: async () => ({ data: items, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const target: NutrientTargets = { calories_kcal: 2000, protein_g: 120, carbs_g: 220, fat_g: 60 }

describe('buildMealBoard (Patch B B1)', () => {
  it('merges every save of the same meal_type into one board row', async () => {
    const supabase = fakeSupabase(
      [
        { id: 'log-1', meal_type: 'lunch' },
        { id: 'log-2', meal_type: 'lunch' },
      ],
      [
        { food_log_id: 'log-1', food_id: 1, food_name_raw: '米饭', food_name_resolved: '米饭', is_estimated: false, energy_kcal: 200, protein_g: 4, carb_g: 44, fat_g: 1 },
        { food_log_id: 'log-1', food_id: 2, food_name_raw: '苦瓜炒蛋', food_name_resolved: '苦瓜炒蛋', is_estimated: false, energy_kcal: 180, protein_g: 10, carb_g: 6, fat_g: 12 },
        { food_log_id: 'log-2', food_id: 3, food_name_raw: '可乐鸡翅', food_name_resolved: '可乐鸡翅', is_estimated: false, energy_kcal: 362, protein_g: 23.2, carb_g: 28, fat_g: 16 },
      ],
    )

    const board = await buildMealBoard(supabase, 'user-1', '2026-09-27', target)

    expect(board.lunch.save_count).toBe(2)
    expect(board.lunch.item_names).toEqual(['米饭', '苦瓜炒蛋', '可乐鸡翅'])
    expect(board.lunch.totals.calories_kcal).toBe(742)
    expect(board.lunch.totals.protein_g).toBeCloseTo(37.2)
    // Lunch is 30–40% of the daily target: 600–800 kcal, so 742 is within range.
    expect(board.lunch.position).toBe('within')
  })

  it('returns an empty row for a meal_type with no saves that day', async () => {
    const supabase = fakeSupabase([], [])
    const board = await buildMealBoard(supabase, 'user-1', '2026-09-27', target)
    expect(board.breakfast.save_count).toBe(0)
    expect(board.breakfast.item_names).toEqual([])
    expect(board.breakfast.totals.calories_kcal).toBeNull()
    expect(board.breakfast.meal_ref).toBeNull()
  })

  it('has all four meal types even when only one has data', async () => {
    const supabase = fakeSupabase(
      [{ id: 'log-1', meal_type: 'breakfast' }],
      [{ food_log_id: 'log-1', food_id: 1, food_name_raw: '燕麦', food_name_resolved: null, is_estimated: false, energy_kcal: 300, protein_g: 12, carb_g: 40, fat_g: 5 }],
    )
    const board = await buildMealBoard(supabase, 'user-1', '2026-09-27', target)
    expect(Object.keys(board).sort()).toEqual(['breakfast', 'dinner', 'lunch', 'snack'])
    expect(board.dinner.save_count).toBe(0)
  })
})
