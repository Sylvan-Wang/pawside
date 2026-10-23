import type { SupabaseClient } from '@supabase/supabase-js'
import type { MealSlot } from './dates'
import type { PersistedItemRow } from './meal'

/** Saved meals (user_food_logs + items) as the chat needs them to edit or list. */

export interface SavedMeal {
  id: string
  log_date: string
  meal_type: MealSlot
  raw_input_text: string | null
  notes: string | null
  /** Kept as the database's text so it round-trips into expected_updated_at exactly. */
  updated_at: string
  created_at: string
  items: PersistedItemRow[]
}

const SELECT = 'id,log_date,meal_type,raw_input_text,notes,updated_at,created_at,user_food_log_items(food_id,food_name_raw,food_name_resolved,weight_g,quantity,unit,is_estimated,energy_kcal,protein_g,carb_g,fat_g,calculation_basis,status)'

function shape(row: Record<string, unknown>): SavedMeal {
  const items = ((row.user_food_log_items as Array<PersistedItemRow & { status: string }> | null) ?? [])
    .filter((item) => item.status !== 'rejected')
  return {
    id: row.id as string,
    log_date: row.log_date as string,
    meal_type: row.meal_type as MealSlot,
    raw_input_text: (row.raw_input_text as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    updated_at: row.updated_at as string,
    created_at: row.created_at as string,
    items,
  }
}

export async function loadSavedMeal(supabase: SupabaseClient, userId: string, foodLogId: string): Promise<SavedMeal | null> {
  const { data, error } = await supabase
    .from('user_food_logs')
    .select(SELECT)
    .eq('id', foodLogId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? shape(data as unknown as Record<string, unknown>) : null
}

export async function findSavedMeals(
  supabase: SupabaseClient,
  userId: string,
  filter: { date: string; mealType?: MealSlot | null },
): Promise<SavedMeal[]> {
  let query = supabase
    .from('user_food_logs')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('log_date', filter.date)
    .order('created_at', { ascending: true })
    .limit(8)
  if (filter.mealType) query = query.eq('meal_type', filter.mealType)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => shape(row as unknown as Record<string, unknown>))
}
