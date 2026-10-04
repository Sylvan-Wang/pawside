import type { SupabaseClient } from '@supabase/supabase-js'
import { buildNutritionTargetSnapshot, type NutritionTargetSnapshot } from './targets'
import {
  calculateNutrients,
  computeNutritionBudget,
  sumConsumed,
  type FoodNutritionPer100g,
  type LoggedFoodItem,
  type NutrientTargets,
  type NutritionBudget,
} from './types'

/**
 * Pawside — normalized nutrition persistence.
 *
 * Canonical write target (Guardrail §15 / Phase 0 map §3.3):
 *   user_food_logs -> user_food_log_items -> daily_nutrition_summary
 *
 * Legacy `food_logs.foods` JSONB is classified COMPATIBILITY_ONLY. It is still
 * written so the not-yet-migrated screens keep working, but the normalized
 * tables are the truth source and `daily_nutrition_summary` is derived from them.
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface FoodItemInput {
  food_id: number | null
  food_name_raw: string
  food_name_resolved: string | null
  weight_g: number
  quantity?: number | null
  unit?: string | null
  is_estimated?: boolean
  resolution_source: 'user_memory' | 'canonical_db' | 'candidate_cache' | 'ai_estimate' | 'user_override'
  source_ref_id: string | null
  user_confirmed: boolean
  /** Reference row used to derive all four macros deterministically. */
  per100g: FoodNutritionPer100g | null
  /** Fallback values when the item was typed without a matched reference row. */
  fallback?: {
    calories_kcal?: number | null
    protein_g?: number | null
    carbs_g?: number | null
    fat_g?: number | null
  }
}

export interface SaveFoodLogInput {
  userId: string
  requestId: string
  logDate: string
  mealType: MealType
  rawInputText?: string | null
  notes?: string | null
  items: FoodItemInput[]
  /** Existing compatibility row promoted on first canonical edit. */
  legacyFoodLogId?: string | null
}

export interface SaveFoodLogResult {
  foodLogId: string
  legacyFoodLogId: string | null
  items: LoggedFoodItem[]
  /** True when at least one item could not be deterministically computed. */
  hasEstimatedItems: boolean
  idempotent: boolean
}

/**
 * Derives one item's four macros.
 *
 * Guards the "trusted numeric fact" rule (AI Patch §31): a user-typed or
 * AI-guessed number is never upgraded to a computed fact. When a reference row
 * exists the computed value wins and the basis is recorded
 * (`calculation_basis`); otherwise the item is flagged `is_estimated`.
 */
export function deriveItemForPersistence(item: FoodItemInput, reference: FoodNutritionPer100g | null) {
  const weight = Number(item.weight_g)
  const confirmedReference = reference ?? (
    item.user_confirmed
      && item.resolution_source === 'user_override'
      && item.per100g?.basis_type === 'per_100g'
      ? item.per100g
      : null
  )
  const computed = confirmedReference ? calculateNutrients(confirmedReference, weight) : null

  if (computed) {
    const estimated = item.resolution_source === 'ai_estimate'
      || item.resolution_source === 'candidate_cache'
    return {
      row: {
        energy_kcal: computed.nutrients.calories_kcal,
        protein_g: computed.nutrients.protein_g,
        carb_g: computed.nutrients.carbs_g,
        fat_g: computed.nutrients.fat_g,
      },
      calculationBasis: {
        ...computed.basis,
        resolution_source: item.food_id === null ? item.resolution_source : 'canonical_db',
        source_ref_id: item.source_ref_id ?? (item.food_id === null ? null : String(item.food_id)),
        user_confirmed: item.user_confirmed,
      },
      isEstimated: estimated,
    }
  }

  if (!item.user_confirmed) {
    throw new Error(`“${item.food_name_raw}”还缺少营养信息，请先确认估算或手动填写`)
  }

  // A confirmed manual/history value is allowed for the user's current log,
  // but it never becomes a canonical food reference.
  const fallback = item.fallback ?? {}
  const values = [
    fallback.calories_kcal,
    fallback.protein_g,
    fallback.carbs_g,
    fallback.fat_g,
  ]
  if (values.some(value => value === null || value === undefined || !Number.isFinite(value))) {
    throw new Error(`“${item.food_name_raw}”还缺少完整营养信息`)
  }
  return {
    row: {
      energy_kcal: fallback.calories_kcal ?? null,
      protein_g: fallback.protein_g ?? null,
      carb_g: fallback.carbs_g ?? null,
      fat_g: fallback.fat_g ?? null,
    },
    calculationBasis: {
      basis_type: 'confirmed_actual',
      resolution_source: item.resolution_source,
      source_ref_id: item.source_ref_id,
      user_confirmed: true,
      per_100g: null,
      weight_g: Number.isFinite(weight) ? weight : null,
      formula: null,
      rounding: 'none',
    },
    isEstimated: item.resolution_source === 'ai_estimate'
      || item.resolution_source === 'candidate_cache',
  }
}

interface PreparedFoodLog {
  rows: Array<{
    food_id: number | null
    food_name_raw: string
    food_name_resolved: string | null
    weight_g: number
    quantity: number | null
    unit: string | null
    is_estimated: boolean
    energy_kcal: number | null
    protein_g: number | null
    carb_g: number | null
    fat_g: number | null
    calculation_basis: unknown
  }>
  legacyFoods: Array<Record<string, unknown>>
  hasEstimatedItems: boolean
}

/**
 * Resolves reference nutrition on the server. Numeric values posted by a
 * browser are display hints only and can never become trusted facts.
 */
async function prepareFoodLog(
  supabase: SupabaseClient,
  items: FoodItemInput[],
): Promise<PreparedFoodLog> {
  const foodIds = [...new Set(
    items.flatMap((item) => item.food_id === null ? [] : [item.food_id]),
  )]

  const references = new Map<number, FoodNutritionPer100g>()
  if (foodIds.length > 0) {
    const { data, error } = await supabase
      .from('food_nutrition')
      .select('food_id,basis_type,energy_kcal,protein_g,carb_g,fat_g,fiber_g,sodium_mg')
      .in('food_id', foodIds)

    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      references.set(Number(row.food_id), {
        basis_type: String(row.basis_type),
        energy_kcal: row.energy_kcal === null ? null : Number(row.energy_kcal),
        protein_g: row.protein_g === null ? null : Number(row.protein_g),
        carb_g: row.carb_g === null ? null : Number(row.carb_g),
        fat_g: row.fat_g === null ? null : Number(row.fat_g),
        fiber_g: row.fiber_g === null ? null : Number(row.fiber_g),
        sodium_mg: row.sodium_mg === null ? null : Number(row.sodium_mg),
      })
    }
  }

  const memoryIds = [...new Set(items.flatMap(item => (
    item.resolution_source === 'user_memory' && item.source_ref_id
      ? [item.source_ref_id]
      : []
  )))]
  const candidateIds = [...new Set(items.flatMap(item => (
    (item.resolution_source === 'candidate_cache' || item.resolution_source === 'ai_estimate')
      && item.source_ref_id
      ? [item.source_ref_id]
      : []
  )))]
  const memoryReferences = new Map<string, FoodNutritionPer100g>()
  const candidateReferences = new Map<string, FoodNutritionPer100g>()
  const referenceFromResolutionRow = (row: Record<string, unknown>): FoodNutritionPer100g => ({
    basis_type: 'per_100g',
    energy_kcal: row.energy_kcal_per_100g == null ? null : Number(row.energy_kcal_per_100g),
    protein_g: row.protein_g_per_100g == null ? null : Number(row.protein_g_per_100g),
    carb_g: row.carb_g_per_100g == null ? null : Number(row.carb_g_per_100g),
    fat_g: row.fat_g_per_100g == null ? null : Number(row.fat_g_per_100g),
    fiber_g: row.fiber_g_per_100g == null ? null : Number(row.fiber_g_per_100g),
  })

  if (memoryIds.length > 0) {
    const { data, error } = await supabase
      .from('user_food_memory')
      .select('id,energy_kcal_per_100g,protein_g_per_100g,carb_g_per_100g,fat_g_per_100g,fiber_g_per_100g')
      .in('id', memoryIds)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      memoryReferences.set(String(row.id), referenceFromResolutionRow(row))
    }
  }

  if (candidateIds.length > 0) {
    const { data, error } = await supabase
      .from('food_resolution_candidates')
      .select('id,energy_kcal_per_100g,protein_g_per_100g,carb_g_per_100g,fat_g_per_100g,fiber_g_per_100g,status,confirm_count')
      .in('id', candidateIds)
      .neq('status', 'rejected')
      .gt('confirm_count', 0)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      candidateReferences.set(String(row.id), referenceFromResolutionRow(row))
    }
  }

  const derived = items.map((item) => ({
    item,
    ...deriveItemForPersistence(
      item,
      item.food_id !== null
        ? references.get(item.food_id) ?? null
        : item.resolution_source === 'user_memory' && item.source_ref_id
          ? memoryReferences.get(item.source_ref_id) ?? null
          : (item.resolution_source === 'candidate_cache' || item.resolution_source === 'ai_estimate')
              && item.source_ref_id
            ? candidateReferences.get(item.source_ref_id) ?? null
            : null,
    ),
  }))

  const rows = derived.map(({ item, row, calculationBasis, isEstimated }) => ({
    food_id: item.food_id,
    food_name_raw: item.food_name_raw,
    food_name_resolved: item.food_name_resolved,
    weight_g: Number(item.weight_g),
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    is_estimated: isEstimated || Boolean(item.is_estimated),
    energy_kcal: row.energy_kcal,
    protein_g: row.protein_g,
    carb_g: row.carb_g,
    fat_g: row.fat_g,
    calculation_basis: calculationBasis,
  }))

  return {
    rows,
    legacyFoods: rows.map((row) => ({
      name: row.food_name_resolved || row.food_name_raw,
      weight_g: row.weight_g,
      calories: row.energy_kcal,
      protein_g: row.protein_g,
      carbs_g: row.carb_g,
      fat_g: row.fat_g,
      food_id: row.food_id,
      is_estimated: row.is_estimated,
    })),
    hasEstimatedItems: rows.some((row) => row.is_estimated),
  }
}

async function loadMealItems(
  supabase: SupabaseClient,
  foodLogId: string,
): Promise<LoggedFoodItem[]> {
  const { data, error } = await supabase
    .from('user_food_log_items')
    .select('food_id,food_name_raw,food_name_resolved,weight_g,quantity,unit,is_estimated,energy_kcal,protein_g,carb_g,fat_g')
    .eq('food_log_id', foodLogId)
    .neq('status', 'rejected')

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    food_id: row.food_id,
    food_name_raw: row.food_name_raw,
    food_name_resolved: row.food_name_resolved,
    weight_g: row.weight_g === null ? null : Number(row.weight_g),
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    is_estimated: row.is_estimated,
    energy_kcal: row.energy_kcal === null ? null : Number(row.energy_kcal),
    protein_g: row.protein_g === null ? null : Number(row.protein_g),
    carb_g: row.carb_g === null ? null : Number(row.carb_g),
    fat_g: row.fat_g === null ? null : Number(row.fat_g),
  }))
}

export async function saveFoodLog(
  supabase: SupabaseClient,
  input: SaveFoodLogInput,
): Promise<SaveFoodLogResult> {
  const prepared = await prepareFoodLog(supabase, input.items)
  const { data, error } = await supabase.rpc('save_food_log_canonical_v1', {
    p_request_id: input.requestId,
    p_log_date: input.logDate,
    p_meal_type: input.mealType,
    p_raw_input_text: input.rawInputText ?? null,
    p_notes: input.notes ?? null,
    p_items: prepared.rows,
    p_legacy_foods: prepared.legacyFoods,
    p_legacy_food_log_id: input.legacyFoodLogId ?? null,
  })

  if (error || !data) throw new Error(error?.message || '无法保存饮食记录')
  const result = data as {
    food_log_id: string
    legacy_food_log_id: string | null
    idempotent: boolean
  }
  const persistedItems = await loadMealItems(supabase, result.food_log_id)

  return {
    foodLogId: result.food_log_id,
    legacyFoodLogId: result.legacy_food_log_id,
    items: persistedItems,
    hasEstimatedItems: persistedItems.some((item) => item.is_estimated),
    idempotent: result.idempotent,
  }
}

export interface ReplaceFoodLogInput extends Omit<SaveFoodLogInput, 'requestId' | 'legacyFoodLogId'> {
  foodLogId: string
  expectedUpdatedAt?: string | null
}

export async function replaceFoodLog(
  supabase: SupabaseClient,
  input: ReplaceFoodLogInput,
): Promise<SaveFoodLogResult & { oldLogDate: string }> {
  const prepared = await prepareFoodLog(supabase, input.items)
  const { data, error } = await supabase.rpc('replace_food_log_canonical_v1', {
    p_food_log_id: input.foodLogId,
    p_log_date: input.logDate,
    p_meal_type: input.mealType,
    p_raw_input_text: input.rawInputText ?? null,
    p_notes: input.notes ?? null,
    p_items: prepared.rows,
    p_legacy_foods: prepared.legacyFoods,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
  })

  if (error || !data) throw new Error(error?.message || '无法更新饮食记录')
  const result = data as {
    food_log_id: string
    legacy_food_log_id: string
    old_log_date: string
  }
  const persistedItems = await loadMealItems(supabase, result.food_log_id)
  return {
    foodLogId: result.food_log_id,
    legacyFoodLogId: result.legacy_food_log_id,
    oldLogDate: result.old_log_date,
    items: persistedItems,
    hasEstimatedItems: persistedItems.some((item) => item.is_estimated),
    idempotent: false,
  }
}

export async function deleteFoodLog(
  supabase: SupabaseClient,
  legacyFoodLogId: string,
): Promise<{ foodLogId: string | null; logDate: string; canonicalDeleted: boolean }> {
  const { data, error } = await supabase.rpc('delete_food_log_canonical_v1', {
    p_legacy_food_log_id: legacyFoodLogId,
  })
  if (error || !data) throw new Error(error?.message || '无法删除饮食记录')
  const result = data as {
    food_log_id: string | null
    log_date: string
    canonical_deleted: boolean
  }
  return {
    foodLogId: result.food_log_id,
    logDate: result.log_date,
    canonicalDeleted: result.canonical_deleted,
  }
}

/** Loads every logged item for a user/day from the canonical tables. */
export async function loadDayItems(
  supabase: SupabaseClient,
  userId: string,
  logDate: string,
): Promise<LoggedFoodItem[]> {
  const rows = await loadDayItemRows(supabase, userId, logDate)
  return rows.map((row) => ({
    food_id: row.food_id,
    food_name_raw: row.food_name_raw,
    food_name_resolved: row.food_name_resolved,
    weight_g: row.weight_g,
    quantity: row.quantity,
    unit: row.unit,
    is_estimated: row.is_estimated,
    energy_kcal: row.energy_kcal,
    protein_g: row.protein_g,
    carb_g: row.carb_g,
    fat_g: row.fat_g,
  }))
}

/**
 * Same as {@link loadDayItems} but keeps the owning meal id, so a caller can
 * group items per meal without issuing a second query (Guardrail §5).
 */
export async function loadDayItemRows(
  supabase: SupabaseClient,
  userId: string,
  logDate: string,
): Promise<Array<LoggedFoodItem & { food_log_id: string }>> {
  const { data: logs, error: logsError } = await supabase
    .from('user_food_logs')
    .select('id, meal_type')
    .eq('user_id', userId)
    .eq('log_date', logDate)

  if (logsError) throw new Error(logsError.message)
  const logIds = (logs ?? []).map((row) => row.id as string)
  if (logIds.length === 0) return []

  const { data: items, error: itemsError } = await supabase
    .from('user_food_log_items')
    .select('food_log_id,food_id,food_name_raw,food_name_resolved,weight_g,quantity,unit,is_estimated,energy_kcal,protein_g,carb_g,fat_g')
    .in('food_log_id', logIds)
    .neq('status', 'rejected')

  if (itemsError) throw new Error(itemsError.message)

  return (items ?? []).map((row) => ({
    food_log_id: row.food_log_id as string,
    food_id: row.food_id,
    food_name_raw: row.food_name_raw,
    food_name_resolved: row.food_name_resolved,
    weight_g: row.weight_g === null ? null : Number(row.weight_g),
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    is_estimated: row.is_estimated,
    energy_kcal: row.energy_kcal === null ? null : Number(row.energy_kcal),
    protein_g: row.protein_g === null ? null : Number(row.protein_g),
    carb_g: row.carb_g === null ? null : Number(row.carb_g),
    fat_g: row.fat_g === null ? null : Number(row.fat_g),
  }))
}

async function countMeals(
  supabase: SupabaseClient,
  userId: string,
  logDate: string,
): Promise<number> {
  const { data } = await supabase
    .from('user_food_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('log_date', logDate)
  return (data ?? []).length
}

/**
 * Recomputes `daily_nutrition_summary` from normalized items.
 *
 * Call after any insert/update/delete on items so the cached summary can never
 * drift from the facts (Product §21).
 */
export async function reconcileDailySummary(
  supabase: SupabaseClient,
  userId: string,
  logDate: string,
): Promise<void> {
  const { error } = await supabase.rpc('reconcile_daily_nutrition_summary_v1', {
    p_user_id: userId,
    p_log_date: logDate,
  })

  if (error) throw new Error(error.message)
}

export interface DailyNutritionFacts extends NutritionBudget {
  meal_count: number
  data_completeness: 'complete' | 'partial' | 'unknown'
}

/**
 * Meal Feedback layer 1 (Product §10.1): target / consumed / remaining, always
 * available without AI.
 *
 * `data_completeness` is `partial` when any item was estimated, so the Calorie
 * caution surface can avoid reading an incomplete log as real low intake
 * (AC-P04).
 */
export async function getDailyNutritionFacts(
  supabase: SupabaseClient,
  userId: string,
  logDate: string,
  target: NutrientTargets,
): Promise<DailyNutritionFacts> {
  const items = await loadDayItems(supabase, userId, logDate)
  const consumed = sumConsumed(items)
  const mealCount = await countMeals(supabase, userId, logDate)

  const budget = computeNutritionBudget(target, consumed)

  let dataCompleteness: DailyNutritionFacts['data_completeness'] = 'complete'
  if (mealCount === 0) dataCompleteness = 'unknown'
  else if (items.some((item) => (
    item.is_estimated
    || item.energy_kcal === null
    || item.protein_g === null
    || item.carb_g === null
    || item.fat_g === null
  ))) dataCompleteness = 'partial'

  return { ...budget, meal_count: mealCount, data_completeness: dataCompleteness }
}

/**
 * Resolves the macro target row for a user.
 *
 * Product §4.1 keeps the three macro targets derived, so this reads the user's
 * calorie target plus body weight and runs the deterministic generator. It does
 * NOT read hand-entered macro columns, because those are not meant to exist.
 */
export async function resolveNutrientTargets(
  supabase: SupabaseClient,
  userId: string,
  effectiveDate?: string,
): Promise<NutrientTargets> {
  return (await resolveNutrientTargetSnapshot(supabase, userId, effectiveDate)).target
}

export interface ResolvedNutritionTarget extends NutritionTargetSnapshot {
  effectiveDate: string | null
  persisted: boolean
}

export async function resolveNutrientTargetSnapshot(
  supabase: SupabaseClient,
  userId: string,
  effectiveDate?: string,
): Promise<ResolvedNutritionTarget> {
  let targetQuery = supabase
    .from('nutrition_targets')
    .select('effective_date,calorie_target_kcal,protein_target_g,carb_target_g,fat_target_g,source,macro_target_status,calculation_basis,evidence_ref_ids')
    .eq('user_id', userId)
  if (effectiveDate) targetQuery = targetQuery.lte('effective_date', effectiveDate)
  const { data: persisted, error: persistedError } = await targetQuery
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (persistedError) throw new Error(persistedError.message)
  if (persisted) {
    return {
      target: {
        calories_kcal: persisted.calorie_target_kcal === null ? null : Number(persisted.calorie_target_kcal),
        protein_g: persisted.protein_target_g === null ? null : Number(persisted.protein_target_g),
        carbs_g: persisted.carb_target_g === null ? null : Number(persisted.carb_target_g),
        fat_g: persisted.fat_target_g === null ? null : Number(persisted.fat_target_g),
      },
      source: persisted.source === 'missing' ? 'missing' : 'user_target',
      macroTargetStatus: persisted.macro_target_status,
      calculationBasis: persisted.calculation_basis,
      evidenceRefIds: persisted.evidence_ref_ids ?? [],
      effectiveDate: String(persisted.effective_date),
      persisted: true,
    } as ResolvedNutritionTarget
  }

  const [profileResult, metricResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('daily_calorie_target,weight_kg')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('body_metrics')
      .select('weight_kg,date')
      .eq('user_id', userId)
      .not('weight_kg', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Weight precedence (Phase 0 map §3.3):
  // latest body_metrics.weight_kg -> user_profiles.weight_kg -> not_assessable
  const profileWeight = profileResult.data?.weight_kg
  const weightKg = metricResult.data?.weight_kg != null
    ? Number(metricResult.data.weight_kg)
    : profileWeight != null
      ? Number(profileWeight)
      : null

  const dailyCalorieTarget = profileResult.data?.daily_calorie_target != null
    ? Number(profileResult.data.daily_calorie_target)
    : null

  const snapshot = buildNutritionTargetSnapshot({
    dailyCalorieTargetKcal: dailyCalorieTarget,
    weightKg,
  })

  return {
    ...snapshot,
    effectiveDate: null,
    persisted: false,
  }
}
