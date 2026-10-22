import type { SupabaseClient } from '@supabase/supabase-js'
import { callStructuredOutput, type StructuredOutputOptions } from '../ai-client'
import {
  actualToPer100g,
  normalizeFoodName,
  type ResolutionSource,
} from './food-resolution'
import type { FoodNutritionPer100g } from './types'

/**
 * Pawside - food resolution service.
 *
 * Extracted from app/api/foods/resolve/route.ts so the food page and the chat
 * assistant share ONE matcher and ONE estimator (Patch §2: "不复制两套食物匹配和估算").
 * The route keeps its response shapes; only the logic moved here.
 */

export interface FoodCandidate {
  source: ResolutionSource
  source_ref_id: string
  name: string
  matched_alias: string | null
  food_id: number | null
  nutrition: Record<string, unknown> | null
  user_confirmed: boolean
}

function nutritionFromResolutionRow(row: Record<string, unknown>) {
  return {
    basis_type: 'per_100g',
    energy_kcal: row.energy_kcal_per_100g == null ? null : Number(row.energy_kcal_per_100g),
    protein_g: row.protein_g_per_100g == null ? null : Number(row.protein_g_per_100g),
    carb_g: row.carb_g_per_100g == null ? null : Number(row.carb_g_per_100g),
    fat_g: row.fat_g_per_100g == null ? null : Number(row.fat_g_per_100g),
    fiber_g: row.fiber_g_per_100g == null ? null : Number(row.fiber_g_per_100g),
  }
}

/** Looks a name up in: personal memory, canonical foods, aliases, confirmed candidates. */
export async function searchFoodCandidates(
  supabase: SupabaseClient,
  userId: string,
  query: string,
): Promise<{ ok: true; data: FoodCandidate[] } | { ok: false }> {
  const trimmed = query.trim()
  if (!trimmed) return { ok: true, data: [] }
  const normalized = normalizeFoodName(trimmed)

  const [memoryResult, canonicalResult, aliasResult, candidateResult] = await Promise.all([
    supabase.from('user_food_memory')
      .select('id,raw_name,normalized_name,energy_kcal_per_100g,protein_g_per_100g,carb_g_per_100g,fat_g_per_100g,fiber_g_per_100g')
      .eq('user_id', userId).ilike('normalized_name', `%${normalized}%`).limit(5),
    supabase.from('foods')
      .select('id,canonical_name,food_nutrition(basis_type,energy_kcal,protein_g,carb_g,fat_g,fiber_g)')
      .eq('is_active', true).ilike('canonical_name', `%${trimmed}%`).limit(10),
    supabase.from('food_aliases')
      .select('alias,foods(id,canonical_name,food_nutrition(basis_type,energy_kcal,protein_g,carb_g,fat_g,fiber_g))')
      .ilike('alias', `%${trimmed}%`).limit(10),
    supabase.from('food_resolution_candidates')
      .select('id,raw_name,normalized_name,energy_kcal_per_100g,protein_g_per_100g,carb_g_per_100g,fat_g_per_100g,fiber_g_per_100g,source_type')
      .neq('status', 'rejected').gt('confirm_count', 0)
      .ilike('normalized_name', `%${normalized}%`).limit(5),
  ])

  const databaseError = memoryResult.error || canonicalResult.error || aliasResult.error || candidateResult.error
  if (databaseError) return { ok: false }

  const results: FoodCandidate[] = []
  for (const row of memoryResult.data ?? []) {
    results.push({
      source: 'user_memory',
      source_ref_id: String(row.id),
      name: String(row.raw_name),
      matched_alias: null,
      food_id: null,
      nutrition: nutritionFromResolutionRow(row),
      user_confirmed: true,
    })
  }

  const seenCanonical = new Set<number>()
  const addCanonical = (food: Record<string, unknown>, matchedAlias: string | null) => {
    const id = Number(food.id)
    if (!Number.isInteger(id) || seenCanonical.has(id)) return
    seenCanonical.add(id)
    const relation = food.food_nutrition
    const value = Array.isArray(relation) ? relation[0] : relation
    results.push({
      source: 'canonical_db',
      source_ref_id: String(id),
      name: String(food.canonical_name),
      matched_alias: matchedAlias,
      food_id: id,
      nutrition: (value ?? null) as Record<string, unknown> | null,
      user_confirmed: true,
    })
  }
  for (const food of canonicalResult.data ?? []) addCanonical(food as unknown as Record<string, unknown>, null)
  for (const row of aliasResult.data ?? []) {
    if (row.foods) addCanonical(row.foods as unknown as Record<string, unknown>, row.alias)
  }

  for (const row of candidateResult.data ?? []) {
    results.push({
      source: 'candidate_cache',
      source_ref_id: String(row.id),
      name: String(row.raw_name),
      matched_alias: null,
      food_id: null,
      nutrition: nutritionFromResolutionRow(row),
      user_confirmed: true,
    })
  }

  return { ok: true, data: results.slice(0, 15) }
}

// ---------------------------------------------------------------------------
// Conservative auto-match (chat only)
// ---------------------------------------------------------------------------

/** "米饭(蒸,籼米)" -> "米饭". Composition-table names carry a qualifier in brackets. */
export function baseFoodName(name: string): string {
  return normalizeFoodName(name.replace(/[（(].*$/, ''))
}

export type MatchQuality = 'exact' | 'none'

export interface PickedCandidate {
  quality: MatchQuality
  candidate: FoodCandidate | null
}

/**
 * Picks a candidate only when the name really IS the food (equal name, equal
 * alias, or equal once the bracketed qualifier is dropped). "Contains" is NOT a
 * match: against the real seed data, 鱼 matches 140 foods and 鸡肉 matches only
 * 鸡肉松 - silently using those would record the wrong nutrition. A miss falls
 * through to a labelled estimate instead.
 *
 * Priority among exact matches: your own confirmed memory, then the canonical
 * table (preferring rows that have portion templates), then confirmed candidates.
 */
export function pickFoodCandidate(
  query: string,
  candidates: FoodCandidate[],
  hasPortionTemplates: (foodId: number) => boolean = () => false,
): PickedCandidate {
  const target = normalizeFoodName(query)
  if (!target) return { quality: 'none', candidate: null }

  const isExact = (candidate: FoodCandidate) =>
    normalizeFoodName(candidate.name) === target
    || baseFoodName(candidate.name) === target
    || (candidate.matched_alias !== null && normalizeFoodName(candidate.matched_alias) === target)

  const rank = (candidate: FoodCandidate) => {
    if (candidate.source === 'user_memory') return 0
    if (candidate.source === 'canonical_db') {
      const exactName = normalizeFoodName(candidate.name) === target ? 0 : 1
      const templated = candidate.food_id !== null && hasPortionTemplates(candidate.food_id) ? 0 : 1
      return 10 + templated * 2 + exactName
    }
    return 20
  }

  const exact = candidates.filter(isExact)
    // Reject rows without usable nutrition: an exact name with no numbers helps nobody.
    .filter((candidate) => candidate.nutrition !== null)
    .sort((a, b) => rank(a) - rank(b) || (a.food_id ?? 0) - (b.food_id ?? 0))
  return exact.length > 0 ? { quality: 'exact', candidate: exact[0] } : { quality: 'none', candidate: null }
}

export function per100gFromCandidate(candidate: FoodCandidate): FoodNutritionPer100g | null {
  const n = candidate.nutrition
  if (!n) return null
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  const basis = typeof n.basis_type === 'string' ? n.basis_type : 'per_100g'
  const result: FoodNutritionPer100g = {
    basis_type: basis,
    energy_kcal: num(n.energy_kcal),
    protein_g: num(n.protein_g),
    carb_g: num(n.carb_g),
    fat_g: num(n.fat_g),
    fiber_g: num(n.fiber_g),
  }
  const complete = [result.energy_kcal, result.protein_g, result.carb_g, result.fat_g]
    .every((value) => value !== null && Number.isFinite(value as number))
  return complete ? result : null
}

// ---------------------------------------------------------------------------
// Portion templates ("1碗" -> grams)
// ---------------------------------------------------------------------------

export interface PortionTemplate {
  portion_name: string
  weight_g: number
}

export async function loadPortionTemplates(
  supabase: SupabaseClient,
  foodIds: number[],
): Promise<Map<number, PortionTemplate[]>> {
  const result = new Map<number, PortionTemplate[]>()
  if (foodIds.length === 0) return result
  const { data, error } = await supabase
    .from('food_portion_templates')
    .select('food_id,portion_name,weight_g')
    .in('food_id', foodIds)
  if (error || !data) return result
  for (const row of data) {
    const list = result.get(Number(row.food_id)) ?? []
    list.push({ portion_name: String(row.portion_name), weight_g: Number(row.weight_g) })
    result.set(Number(row.food_id), list)
  }
  return result
}

/**
 * Grams for "<amount><unit>" from the food's templates. Templates are named
 * like "1个", "2个", "1大碗", "一把". The user's unit must appear in the template
 * name; when several sizes fit (大/中/小碗) the middle one wins, and the caller
 * labels the result as a typical portion.
 */
export function gramsFromPortion(
  templates: PortionTemplate[],
  amountValue: number | null,
  amountUnit: string | null,
): { grams: number; label: string } | null {
  const unit = amountUnit?.trim()
  if (!unit || templates.length === 0) return null
  const count = amountValue ?? 1
  if (!(count > 0)) return null

  const parsed = templates
    .filter((template) => template.portion_name.includes(unit) && template.weight_g > 0)
    .map((template) => {
      const match = template.portion_name.match(/^(\d+(?:\.\d+)?)/)
      const n = match ? Number(match[1]) : 1
      return { template, perUnit: template.weight_g / (n > 0 ? n : 1) }
    })
  if (parsed.length === 0) return null

  const middle = parsed.find((entry) => entry.template.portion_name.includes('中')) ?? parsed[0]
  return { grams: middle.perUnit * count, label: middle.template.portion_name }
}

// ---------------------------------------------------------------------------
// AI estimate (provisional per-100g). Never a measured fact.
// ---------------------------------------------------------------------------

export interface EstimatePayload {
  energy_kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
  fiber_g: number | null
  confidence: number
  caveat: string
}

export const estimateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    energy_kcal: { type: 'number', minimum: 0 },
    protein_g: { type: 'number', minimum: 0 },
    carb_g: { type: 'number', minimum: 0 },
    fat_g: { type: 'number', minimum: 0 },
    fiber_g: { type: ['number', 'null'], minimum: 0 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    caveat: { type: 'string', maxLength: 120 },
  },
  required: ['energy_kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g', 'confidence', 'caveat'],
} as const

const nonNegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function validEstimate(value: unknown): value is EstimatePayload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return nonNegative(v.energy_kcal) && nonNegative(v.protein_g) && nonNegative(v.carb_g)
    && nonNegative(v.fat_g)
    && (v.fiber_g === null || nonNegative(v.fiber_g))
    && typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1
    && typeof v.caveat === 'string'
}

const ESTIMATE_INSTRUCTIONS =
  'Estimate a typical per-100g nutrition profile for the named food. Return a provisional estimate only. Do not claim a brand, database match, or medical certainty. All numeric fields must describe 100 grams.'

export async function estimateFoodPer100g(name: string, options?: StructuredOutputOptions) {
  return callStructuredOutput<EstimatePayload>(
    ESTIMATE_INSTRUCTIONS,
    JSON.stringify({ food_name: name, basis: 'per_100g' }),
    'pawside_food_estimate_v1',
    estimateSchema,
    validEstimate,
    300,
    options,
  )
}

export interface BatchEstimate extends EstimatePayload {
  name: string
}

const BATCH_MAX = 6

const batchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    foods: {
      type: 'array',
      maxItems: BATCH_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string', maxLength: 60 }, ...estimateSchema.properties },
        required: ['name', ...estimateSchema.required],
      },
    },
  },
  required: ['foods'],
} as const

function validBatch(value: unknown): value is { foods: BatchEstimate[] } {
  if (!value || typeof value !== 'object') return false
  const foods = (value as { foods?: unknown }).foods
  return Array.isArray(foods)
    && foods.length <= BATCH_MAX
    && foods.every((food) => food && typeof food === 'object'
      && typeof (food as { name?: unknown }).name === 'string'
      && validEstimate(food))
}

/**
 * One model call for several foods (the chat resolves a whole sentence at once,
 * and most real dish names miss the composition table). Results are matched
 * back by name; a food the model skipped simply has no estimate.
 */
export async function estimateFoodsPer100g(
  names: string[],
  options?: StructuredOutputOptions,
): Promise<{ ok: true; byName: Map<string, EstimatePayload>; model: string } | { ok: false; reason: string; model: string }> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, BATCH_MAX)
  if (unique.length === 0) return { ok: true, byName: new Map(), model: options?.model ?? '' }
  const result = await callStructuredOutput<{ foods: BatchEstimate[] }>(
    `${ESTIMATE_INSTRUCTIONS} Return one entry per requested food, using exactly the requested name.`,
    JSON.stringify({ foods: unique, basis: 'per_100g' }),
    'pawside_food_estimates_v1',
    batchSchema,
    validBatch,
    200 + unique.length * 160,
    options,
  )
  if (!result.ok) return { ok: false, reason: result.reason, model: result.model }
  const byName = new Map<string, EstimatePayload>()
  for (const food of result.data.foods) {
    if (unique.includes(food.name)) byName.set(food.name, food)
  }
  return { ok: true, byName, model: result.model }
}

// ---------------------------------------------------------------------------
// Explicit user confirmation of a per-food nutrition (food page flow)
// ---------------------------------------------------------------------------

export interface ConfirmFoodInput {
  name: string
  brand?: string | null
  source: 'ai_estimate' | 'user_override'
  weight_g: number
  actual: {
    energy_kcal: number
    protein_g: number
    carb_g: number
    fat_g: number
    fiber_g?: number | null
  }
  confidence?: number | null
}

export async function confirmFoodNutrition(
  supabase: SupabaseClient,
  userId: string,
  input: ConfirmFoodInput,
): Promise<
  | { ok: true; data: { source: string; source_ref_id: string; memory_id: string; nutrition: FoodNutritionPer100g; user_confirmed: true } }
  | { ok: false; error: 'candidate' | 'memory' }
> {
  const per100g = actualToPer100g({
    weightG: input.weight_g,
    energyKcal: input.actual.energy_kcal,
    proteinG: input.actual.protein_g,
    carbG: input.actual.carb_g,
    fatG: input.actual.fat_g,
    fiberG: input.actual.fiber_g,
  })
  const normalizedName = normalizeFoodName(input.name)
  let candidateId: string | null = null

  if (input.source === 'ai_estimate') {
    const { data: candidate, error } = await supabase.from('food_resolution_candidates').insert({
      created_by: userId,
      normalized_name: normalizedName,
      raw_name: input.name,
      brand: input.brand ?? null,
      energy_kcal_per_100g: per100g.energy_kcal,
      protein_g_per_100g: per100g.protein_g,
      carb_g_per_100g: per100g.carb_g,
      fat_g_per_100g: per100g.fat_g,
      fiber_g_per_100g: per100g.fiber_g ?? null,
      source_type: 'ai_estimate',
      confidence: input.confidence ?? null,
      source_detail: { confirmation: 'explicit_user_action', basis_type: 'per_100g' },
    }).select('id').single()
    if (error) return { ok: false, error: 'candidate' }
    candidateId = candidate.id
  }

  const { data: memory, error: memoryError } = await supabase.from('user_food_memory').upsert({
    user_id: userId,
    normalized_name: normalizedName,
    raw_name: input.name,
    brand: input.brand ?? null,
    energy_kcal_per_100g: per100g.energy_kcal,
    protein_g_per_100g: per100g.protein_g,
    carb_g_per_100g: per100g.carb_g,
    fat_g_per_100g: per100g.fat_g,
    fiber_g_per_100g: per100g.fiber_g ?? null,
    source_type: input.source,
    source_ref_id: candidateId,
    last_confirmed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,normalized_name' }).select('id').single()

  if (memoryError) return { ok: false, error: 'memory' }
  return {
    ok: true,
    data: {
      source: input.source,
      source_ref_id: candidateId ?? memory.id,
      memory_id: memory.id,
      nutrition: per100g,
      user_confirmed: true,
    },
  }
}
