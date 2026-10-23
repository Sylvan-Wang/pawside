import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDayItemRows, resolveNutrientTargets } from '../nutrition/persistence'
import type { NutrientTargets } from '../nutrition/types'
import type { QueryAspect } from './schemas'

/**
 * "What actually happened on a day", read from the authoritative tables
 * (user_food_logs/items, workout_logs, body_metrics). Plans are never counted
 * as done; an unfinished training session is listed apart from completed work.
 */

export interface DayMeal {
  id: string
  meal_type: string
  created_at: string
  items: Array<{ name: string; weight_g: number | null; energy_kcal: number | null }>
  unknown_item_count: number
  known_energy_kcal: number | null
}

export interface DayWorkout {
  id: string
  type: string
  duration_minutes: number | null
  calories_burned_kcal: number | null
  source: 'training_runner' | 'free'
}

export interface DayFacts {
  date: string
  aspects: QueryAspect[]
  meals: DayMeal[]
  nutrition: {
    target_kcal: number | null
    /** Sum over items whose calories are known. */
    known_kcal: number | null
    unknown_item_count: number
    /** The day's list is only trustworthy as a total when every item has calories. */
    complete: boolean
    remaining_kcal: number | null
    targets: NutrientTargets
  }
  workouts: DayWorkout[]
  unfinished_sessions: number
  weight_kg: number | null
}

export async function getDayFacts(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  aspects: QueryAspect[],
): Promise<DayFacts> {
  const wants = (aspect: QueryAspect) => aspects.includes(aspect)
  const empty: DayFacts = {
    date,
    aspects,
    meals: [],
    nutrition: {
      target_kcal: null,
      known_kcal: null,
      unknown_item_count: 0,
      complete: false,
      remaining_kcal: null,
      targets: { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null },
    },
    workouts: [],
    unfinished_sessions: 0,
    weight_kg: null,
  }

  if (wants('meals') || wants('nutrition')) {
    const [{ data: logs, error }, rows, targets] = await Promise.all([
      supabase
        .from('user_food_logs')
        .select('id,meal_type,created_at')
        .eq('user_id', userId)
        .eq('log_date', date)
        .order('created_at', { ascending: true }),
      loadDayItemRows(supabase, userId, date),
      resolveNutrientTargets(supabase, userId, date),
    ])
    if (error) throw new Error(error.message)

    empty.meals = (logs ?? []).map((log) => {
      const items = rows.filter((row) => row.food_log_id === log.id)
      const known = items.filter((item) => item.energy_kcal !== null)
      return {
        id: log.id as string,
        meal_type: log.meal_type as string,
        created_at: log.created_at as string,
        items: items.map((item) => ({
          // What the user said, not the matched table name ("米饭", not "米饭(蒸,籼米)").
          name: item.food_name_raw,
          weight_g: item.weight_g,
          energy_kcal: item.energy_kcal,
        })),
        unknown_item_count: items.length - known.length,
        known_energy_kcal: known.length > 0 ? known.reduce((sum, item) => sum + (item.energy_kcal ?? 0), 0) : null,
      }
    })

    const unknown = rows.filter((row) => row.energy_kcal === null).length
    const knownRows = rows.filter((row) => row.energy_kcal !== null)
    const knownKcal = knownRows.length > 0 ? knownRows.reduce((sum, row) => sum + (row.energy_kcal ?? 0), 0) : null
    const complete = rows.length > 0 && unknown === 0
    empty.nutrition = {
      target_kcal: targets.calories_kcal,
      known_kcal: knownKcal,
      unknown_item_count: unknown,
      complete,
      // "Remaining" is only said out loud when it is not distorted by unknown items.
      remaining_kcal: complete && targets.calories_kcal !== null && knownKcal !== null
        ? targets.calories_kcal - knownKcal
        : null,
      targets,
    }
  }

  if (wants('workouts')) {
    const [{ data: logs, error: logError }, { count, error: sessionError }] = await Promise.all([
      supabase
        .from('workout_logs')
        .select('id,type,duration_minutes,calories_burned_kcal,method_workout_session_id')
        .eq('user_id', userId)
        .eq('date', date)
        .order('created_at', { ascending: true }),
      supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('log_date', date)
        .eq('status', 'started'),
    ])
    if (logError) throw new Error(logError.message)
    if (sessionError) throw new Error(sessionError.message)
    empty.workouts = (logs ?? []).map((log) => ({
      id: log.id as string,
      type: log.type as string,
      duration_minutes: log.duration_minutes === null ? null : Number(log.duration_minutes),
      calories_burned_kcal: log.calories_burned_kcal === null ? null : Number(log.calories_burned_kcal),
      // A training-runner session is mirrored into workout_logs; it appears once, here.
      source: log.method_workout_session_id ? 'training_runner' : 'free',
    }))
    empty.unfinished_sessions = count ?? 0
  }

  if (wants('weight')) {
    const { data, error } = await supabase
      .from('body_metrics')
      .select('weight_kg')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle()
    if (error) throw new Error(error.message)
    empty.weight_kg = data?.weight_kg == null ? null : Number(data.weight_kg)
  }

  return empty
}
