import type { SupabaseClient } from '@supabase/supabase-js'
import { formatNumber } from '../coach/display'
import {
  gramsFromPortion,
  loadPortionTemplates,
  per100gFromCandidate,
  pickFoodCandidate,
  searchFoodCandidates,
  type EstimatePayload,
  type FoodCandidate,
  type PortionTemplate,
} from '../nutrition/food-resolver'
import { normalizeFoodName } from '../nutrition/food-resolution'
import type { FoodItemInput } from '../nutrition/persistence'
import { calculateNutrients } from '../nutrition/types'
import type { DateSource, MealSlot } from './dates'
import type { PlanEdit, PlanItem } from './schemas'
import type {
  Macros,
  MealDraftItem,
  MealDraftPayload,
  MealTotals,
  NutritionStatus,
  Per100g,
  WeightBasis,
} from './types'

/**
 * Meal drafts: turning "what the user said" into items with a weight and
 * nutrition, and applying edits to them. No nutrition is ever computed by the
 * model - it supplies words and (labelled) weight guesses; this file looks up or
 * estimates per-100g values and multiplies (lib/nutrition/types.calculateNutrients).
 */

export type FoodEstimator = (names: string[]) => Promise<
  | { ok: true; byName: Map<string, EstimatePayload> }
  | { ok: false; reason: string }
>

export const UNKNOWN_MACROS: Macros = { energy_kcal: null, protein_g: null, carb_g: null, fat_g: null }

const GUESSED_BASES: ReadonlySet<WeightBasis> = new Set(['portion_template', 'model_estimate', 'volume_assumed', 'unknown'])

const ESTIMATED_BASES: ReadonlySet<WeightBasis> = new Set([
  'portion_template',
  'model_estimate',
  'volume_assumed',
  'scaled',
])

export function amountText(item: Pick<PlanItem, 'amountValue' | 'amountUnit'>): string | null {
  if (item.amountValue === null || !item.amountUnit) return null
  return `${formatNumber(item.amountValue, undefined, 2)}${item.amountUnit}`
}

function macrosFrom(per100g: Per100g | null, grams: number | null): Macros | null {
  if (!per100g || grams === null) return null
  const calculated = calculateNutrients(per100g, grams)
  if (!calculated) return null
  const n = calculated.nutrients
  const macros: Macros = {
    energy_kcal: n.calories_kcal,
    protein_g: n.protein_g,
    carb_g: n.carbs_g,
    fat_g: n.fat_g,
  }
  const complete = Object.values(macros).every((value) => value !== null)
  return complete ? macros : null
}

export function computeTotals(items: MealDraftItem[]): MealTotals {
  const known: Macros = { energy_kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }
  let unknown = 0
  let estimated = 0
  let anyKnown = false
  for (const item of items) {
    if (item.nutrition === null) {
      unknown += 1
      continue
    }
    anyKnown = true
    known.energy_kcal = (known.energy_kcal ?? 0) + (item.nutrition.energy_kcal ?? 0)
    known.protein_g = (known.protein_g ?? 0) + (item.nutrition.protein_g ?? 0)
    known.carb_g = (known.carb_g ?? 0) + (item.nutrition.carb_g ?? 0)
    known.fat_g = (known.fat_g ?? 0) + (item.nutrition.fat_g ?? 0)
    if (item.nutrition_status === 'estimated') estimated += 1
  }
  return {
    // With nothing known, the known total is "unknown", not 0.
    known: anyKnown ? known : { ...UNKNOWN_MACROS },
    item_count: items.length,
    unknown_item_count: unknown,
    estimated_item_count: estimated,
  }
}

function toPer100g(value: object): Per100g {
  const v = value as Record<string, unknown>
  const num = (x: unknown) => (x === null || x === undefined ? null : Number(x))
  return {
    basis_type: 'per_100g',
    energy_kcal: num(v.energy_kcal),
    protein_g: num(v.protein_g),
    carb_g: num(v.carb_g),
    fat_g: num(v.fat_g),
    fiber_g: num(v.fiber_g),
  }
}

function finishItem(base: Omit<MealDraftItem, 'nutrition' | 'nutrition_status' | 'fixed_actuals'> & {
  fixed_actuals?: boolean
  forceUnknown?: boolean
}): MealDraftItem {
  const nutrition = base.forceUnknown ? null : macrosFrom(base.per100g, base.weight_g)
  let status: NutritionStatus = 'unknown'
  if (nutrition) {
    status = ESTIMATED_BASES.has(base.weight_basis)
      || base.resolution_source === 'ai_estimate'
      || base.resolution_source === 'candidate_cache'
      ? 'estimated'
      : 'resolved'
  }
  const { forceUnknown: _ignored, fixed_actuals, ...item } = base
  void _ignored
  return { ...item, nutrition, nutrition_status: status, fixed_actuals: fixed_actuals ?? false }
}

/** Weight for one item: stated grams > portion template > model's guess > unknown. */
export function chooseWeight(
  item: PlanItem,
  templates: PortionTemplate[] | undefined,
): { grams: number | null; basis: WeightBasis; label: string | null } {
  if (item.grams !== null && (item.gramsBasis === 'user_grams' || item.gramsBasis === 'unit_conversion' || item.gramsBasis === 'volume_assumed')) {
    return { grams: item.grams, basis: item.gramsBasis, label: null }
  }
  if (templates && item.amountUnit) {
    const portion = gramsFromPortion(templates, item.amountValue, item.amountUnit)
    if (portion) return { grams: portion.grams, basis: 'portion_template', label: portion.label }
  }
  if (item.grams !== null) return { grams: item.grams, basis: item.gramsBasis, label: null }
  return { grams: null, basis: 'unknown', label: null }
}

export interface ResolvedItems {
  items: MealDraftItem[]
  warnings: string[]
}

/**
 * Resolves plan items against memory / the canonical table / confirmed
 * candidates; whatever misses (and has a weight) is estimated in ONE batched
 * model call. Without a weight nothing can be computed, so the item stays
 * raw-only - recorded, nutrition pending.
 */
export async function resolveItems(
  supabase: SupabaseClient,
  userId: string,
  planItems: PlanItem[],
  estimator: FoodEstimator,
): Promise<ResolvedItems> {
  const warnings: string[] = []

  const lookups = await Promise.all(planItems.map((item) => searchFoodCandidates(supabase, userId, item.name)))
  if (lookups.some((lookup) => !lookup.ok)) warnings.push('food_lookup_failed')
  const candidatesByIndex: FoodCandidate[][] = lookups.map((lookup) => (lookup.ok ? lookup.data : []))

  const foodIds = [...new Set(candidatesByIndex.flatMap((list) => list.flatMap((c) => (c.food_id === null ? [] : [c.food_id]))))]
  const templatesByFood = await loadPortionTemplates(supabase, foodIds)

  const picks = planItems.map((item, index) => pickFoodCandidate(
    item.name,
    candidatesByIndex[index],
    (foodId) => (templatesByFood.get(foodId)?.length ?? 0) > 0,
  ))

  const weights = planItems.map((item, index) => {
    const foodId = picks[index].candidate?.food_id ?? null
    return chooseWeight(item, foodId === null ? undefined : templatesByFood.get(foodId))
  })

  const needEstimate = planItems
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => picks[index].candidate === null && weights[index].grams !== null)
  let estimates = new Map<string, EstimatePayload>()
  if (needEstimate.length > 0) {
    const result = await estimator(needEstimate.map(({ item }) => item.name))
    if (result.ok) estimates = result.byName
    else warnings.push('estimate_unavailable')
  }

  const items = planItems.map((item, index): MealDraftItem => {
    const pick = picks[index].candidate
    const weight = weights[index]
    const common = {
      name_raw: item.name,
      amount_text: amountText(item),
      quantity: item.amountValue,
      unit: item.amountUnit,
      weight_g: weight.grams,
      weight_basis: weight.basis,
    }

    if (pick) {
      // A per-100ml (or other) basis is not silently treated as per-100g.
      const reference = per100gFromCandidate(pick)
      const per100g = reference && reference.basis_type === 'per_100g' ? toPer100g(reference) : null
      return finishItem({
        ...common,
        name_resolved: pick.name,
        food_id: pick.food_id,
        resolution_source: pick.source,
        source_ref_id: pick.source_ref_id,
        per100g,
        caveat: weight.label ? `按「${weight.label}」的常见重量计算` : null,
        forceUnknown: per100g === null,
      })
    }

    const estimate = estimates.get(item.name)
    if (estimate && weight.grams !== null) {
      return finishItem({
        ...common,
        name_resolved: null,
        food_id: null,
        resolution_source: 'ai_estimate',
        source_ref_id: null,
        per100g: toPer100g(estimate),
        caveat: estimate.caveat || '营养按常见做法估算，不同做法差别较大',
      })
    }

    return finishItem({
      ...common,
      name_resolved: null,
      food_id: null,
      resolution_source: 'unresolved',
      source_ref_id: null,
      per100g: null,
      caveat: weight.grams === null ? '没有说份量，先只记录吃了什么' : '暂时没法估算营养，先只记录吃了什么',
      forceUnknown: true,
    })
  })

  return { items, warnings }
}

export function buildMealPayload(input: {
  date: string
  dateSource: DateSource
  mealType: MealSlot
  mealTypeSource: MealDraftPayload['meal_type_source']
  rawText: string
  items: MealDraftItem[]
  warnings?: string[]
  before?: { summary: string }
  notes?: string | null
}): MealDraftPayload {
  return {
    v: 1,
    date: input.date,
    date_source: input.dateSource,
    meal_type: input.mealType,
    meal_type_source: input.mealTypeSource,
    raw_text: input.rawText.slice(0, 500),
    items: input.items,
    totals: computeTotals(input.items),
    warnings: input.warnings ?? [],
    ...(input.before ? { before: input.before } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** Finds the one item an edit refers to. Ambiguous or missing -> null (never guess). */
export function findItemIndex(items: MealDraftItem[], target: string): number | null {
  const wanted = normalizeFoodName(target)
  if (!wanted) return null
  const names = (item: MealDraftItem) => [item.name_raw, item.name_resolved ?? ''].map(normalizeFoodName).filter(Boolean)

  const exact = items.flatMap((item, index) => (names(item).includes(wanted) ? [index] : []))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null

  const partial = items.flatMap((item, index) =>
    names(item).some((name) => name.includes(wanted) || wanted.includes(name)) ? [index] : [])
  return partial.length === 1 ? partial[0] : null
}

function rescale(item: MealDraftItem, grams: number, basis: WeightBasis): MealDraftItem {
  const factor = item.weight_g && item.weight_g > 0 ? grams / item.weight_g : null
  if (item.fixed_actuals && item.nutrition && factor !== null) {
    const scale = (value: number | null) => (value === null ? null : value * factor)
    return {
      ...item,
      weight_g: grams,
      weight_basis: basis,
      amount_text: null,
      quantity: null,
      unit: null,
      nutrition: {
        energy_kcal: scale(item.nutrition.energy_kcal),
        protein_g: scale(item.nutrition.protein_g),
        carb_g: scale(item.nutrition.carb_g),
        fat_g: scale(item.nutrition.fat_g),
      },
      nutrition_status: item.nutrition_status === 'resolved' ? 'estimated' : item.nutrition_status,
    }
  }
  const recomputed = macrosFrom(item.per100g, grams)
  return {
    ...item,
    weight_g: grams,
    weight_basis: basis,
    amount_text: null,
    quantity: null,
    unit: null,
    nutrition: recomputed,
    nutrition_status: recomputed
      ? item.resolution_source === 'ai_estimate' || item.resolution_source === 'candidate_cache' || ESTIMATED_BASES.has(basis)
        ? 'estimated'
        : item.nutrition_status === 'unknown' ? 'resolved' : item.nutrition_status
      : 'unknown',
  }
}

export interface EditOutcome {
  items: MealDraftItem[]
  applied: string[]
  /** Edits that could not be applied, with the user's wording - reported, never silently skipped. */
  unmatched: string[]
  warnings: string[]
}

/**
 * Applies edit operations to a copy of the items. Scaling an item that has no
 * weight, or naming an item that isn't there (or matches two), is reported in
 * `unmatched`; the original items are left as they were for those.
 */
export async function applyEdits(input: {
  supabase: SupabaseClient
  userId: string
  items: MealDraftItem[]
  edits: PlanEdit[]
  added: PlanItem[]
  estimator: FoodEstimator
}): Promise<EditOutcome> {
  let items = input.items.map((item) => ({ ...item }))
  const applied: string[] = []
  const unmatched: string[] = []
  const warnings: string[] = []
  const replacements: Array<{ index: number; plan: PlanItem }> = []

  for (const edit of input.edits) {
    if (edit.action === 'scale_all') {
      const factor = edit.factor as number
      let any = false
      items = items.map((item) => {
        if (item.weight_g === null) return item
        any = true
        return rescale(item, item.weight_g * factor, 'scaled')
      })
      const skipped = items.filter((item) => item.weight_g === null).length
      if (any) applied.push(`全部 ×${formatNumber(factor, undefined, 2)}`)
      else unmatched.push('全部份量（没有可调整的重量）')
      if (any && skipped > 0) warnings.push('some_items_without_weight')
      continue
    }

    const target = edit.targetItem as string
    const index = findItemIndex(items, target)
    if (index === null) {
      unmatched.push(target)
      continue
    }
    const item = items[index]

    if (edit.action === 'remove_item') {
      if (items.length === 1) {
        unmatched.push(`${target}（这是这餐里唯一的食物，要删掉整餐请到饮食记录里操作）`)
        continue
      }
      items = items.filter((_, i) => i !== index)
      applied.push(`去掉 ${item.name_raw}`)
    } else if (edit.action === 'scale_item') {
      if (item.weight_g === null) {
        unmatched.push(`${target}（没有记过重量）`)
        continue
      }
      items[index] = rescale(item, item.weight_g * (edit.factor as number), 'scaled')
      applied.push(`${item.name_raw} ×${formatNumber(edit.factor, undefined, 2)}`)
    } else if (edit.action === 'set_grams') {
      items[index] = rescale(
        item.weight_g === null ? { ...item, weight_g: edit.grams as number } : item,
        edit.grams as number,
        'user_grams',
      )
      applied.push(`${item.name_raw} 改为 ${formatNumber(edit.grams, 'g')}g`)
    } else if (edit.action === 'replace_food') {
      replacements.push({
        index,
        plan: {
          name: edit.newName as string,
          amountValue: null,
          amountUnit: null,
          grams: item.weight_g,
          gramsBasis: item.weight_g === null ? 'unknown' : 'user_grams',
          dishKind: 'single',
        },
      })
      applied.push(`${item.name_raw} → ${edit.newName}`)
    }
  }

  const toResolve = [...replacements.map((r) => r.plan), ...input.added]
  if (toResolve.length > 0) {
    const resolved = await resolveItems(input.supabase, input.userId, toResolve, input.estimator)
    warnings.push(...resolved.warnings)
    replacements.forEach((replacement, i) => {
      const old = items[replacement.index]
      // The portion stays what it was; only the food changes.
      items[replacement.index] = {
        ...resolved.items[i],
        weight_g: old.weight_g,
        weight_basis: old.weight_g === null ? 'unknown' : 'kept',
      }
    })
    const added = resolved.items.slice(replacements.length)
    if (added.length > 0) applied.push(`加上 ${added.map((a) => a.name_raw).join('、')}`)
    items = [...items, ...added]
  }

  return { items, applied, unmatched, warnings: [...new Set(warnings)] }
}

// ---------------------------------------------------------------------------
// Saved meals <-> draft items
// ---------------------------------------------------------------------------

export interface PersistedItemRow {
  food_id: number | null
  food_name_raw: string
  food_name_resolved: string | null
  weight_g: number | string | null
  quantity: number | string | null
  unit: string | null
  is_estimated: boolean
  energy_kcal: number | string | null
  protein_g: number | string | null
  carb_g: number | string | null
  fat_g: number | string | null
  calculation_basis: Record<string, unknown> | null
}

const asNumber = (value: number | string | null | undefined) =>
  value === null || value === undefined ? null : Number(value)

/** Rebuilds editable draft items from a saved meal's rows. */
export function itemsFromPersisted(rows: PersistedItemRow[]): MealDraftItem[] {
  return rows.map((row): MealDraftItem => {
    const weight = asNumber(row.weight_g)
    const macros: Macros = {
      energy_kcal: asNumber(row.energy_kcal),
      protein_g: asNumber(row.protein_g),
      carb_g: asNumber(row.carb_g),
      fat_g: asNumber(row.fat_g),
    }
    const known = Object.values(macros).every((value) => value !== null)
    const basis = (row.calculation_basis ?? {}) as Record<string, unknown>
    const per100gRaw = basis.per_100g as Record<string, unknown> | null | undefined
    const hasPer100g = basis.basis_type === 'per_100g' && per100gRaw
      && ['energy_kcal', 'protein_g', 'carb_g', 'fat_g'].every((key) => per100gRaw[key] !== null && per100gRaw[key] !== undefined)
    const source = (typeof basis.resolution_source === 'string' ? basis.resolution_source : null) as MealDraftItem['resolution_source'] | null
    const common = {
      name_raw: row.food_name_raw,
      name_resolved: row.food_name_resolved,
      amount_text: null,
      quantity: asNumber(row.quantity),
      unit: row.unit,
      food_id: row.food_id,
      weight_g: weight,
      weight_basis: 'kept' as const,
      caveat: null,
    }

    if (!known) {
      return {
        ...common,
        resolution_source: 'unresolved',
        source_ref_id: null,
        per100g: null,
        nutrition: null,
        nutrition_status: 'unknown',
        fixed_actuals: false,
      }
    }

    const status: NutritionStatus = row.is_estimated ? 'estimated' : 'resolved'
    if (hasPer100g) {
      return {
        ...common,
        resolution_source: row.food_id !== null ? 'canonical_db' : (source && source !== 'unresolved' ? source : 'user_override'),
        source_ref_id: typeof basis.source_ref_id === 'string' ? basis.source_ref_id : (row.food_id !== null ? String(row.food_id) : null),
        per100g: toPer100g(per100gRaw as Record<string, unknown>),
        nutrition: macros,
        nutrition_status: status,
        fixed_actuals: false,
      }
    }

    return {
      ...common,
      resolution_source: 'user_override',
      source_ref_id: null,
      per100g: null,
      nutrition: macros,
      nutrition_status: status,
      fixed_actuals: true,
    }
  })
}

/** The inputs persistence needs. Numbers are re-derived server-side from references. */
export function toFoodInputs(items: MealDraftItem[]): FoodItemInput[] {
  return items.map((item): FoodItemInput => {
    const base = {
      food_name_raw: item.name_raw,
      food_name_resolved: item.name_resolved ?? item.name_raw,
      weight_g: item.weight_g,
      quantity: item.quantity,
      unit: item.unit,
      user_confirmed: true,
      per100g: null,
    }

    if (item.nutrition === null) {
      return {
        ...base,
        food_id: item.food_id,
        food_name_resolved: item.name_resolved,
        resolution_source: 'user_override',
        source_ref_id: null,
        nutrition_unknown: true,
        // A weight the user did not state (a typical portion, or the model's guess) is stored as an estimate.
        is_estimated: item.weight_g !== null && GUESSED_BASES.has(item.weight_basis),
      }
    }

    if (item.fixed_actuals) {
      return {
        ...base,
        food_id: null,
        resolution_source: 'user_override',
        source_ref_id: null,
        is_estimated: item.nutrition_status === 'estimated',
        fallback: {
          calories_kcal: item.nutrition.energy_kcal,
          protein_g: item.nutrition.protein_g,
          carbs_g: item.nutrition.carb_g,
          fat_g: item.nutrition.fat_g,
        },
      }
    }

    if (item.resolution_source === 'ai_estimate' && item.source_ref_id === null) {
      return {
        ...base,
        food_id: null,
        food_name_resolved: item.name_raw,
        resolution_source: 'ai_estimate',
        source_ref_id: null,
        provisional_per100g: item.per100g,
        is_estimated: true,
      }
    }

    const source = item.resolution_source === 'unresolved' ? 'user_override' : item.resolution_source
    return {
      ...base,
      food_id: item.food_id,
      resolution_source: source,
      source_ref_id: item.source_ref_id,
      is_estimated: item.nutrition_status === 'estimated',
    }
  })
}

export const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

/** One-line, number-light summary for the planner context and replies. */
export function summarizeMeal(payload: Pick<MealDraftPayload, 'meal_type' | 'items'>): string {
  const parts = payload.items.map((item) => {
    const weight = item.weight_g === null ? '' : ` ${formatNumber(item.weight_g, 'g')}g`
    return `${item.name_raw}${weight}`
  })
  return `${MEAL_LABELS[payload.meal_type]}：${parts.join('、')}`
}
