/**
 * Pawside — Nutrition fact layer (deterministic).
 *
 * Authority:
 *   AI Patch §9    — actual_nutrient = per_100g × actual_weight_g / 100
 *   AI Patch §10   — target generator input/output
 *   AI Patch §12.1 — macro derivation (see ./macro-targets)
 *   Product §10.1  — Meal Feedback order: Facts → Status → Explanation
 *   Product §27    — no target => show consumed, never a fabricated target
 *   Guardrail §6   — AI may never compute these numbers
 *
 * Guardrail §12 discipline: `consumed` is always a number (0 means "nothing
 * recorded yet"); `target`/`remaining` are `number | null` where null means
 * "no target set". 0 and null are never interchangeable.
 */

export interface NutrientVector {
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

export interface NutrientTargets {
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

/** `remaining = target - consumed`. Negative is preserved, never clamped. */
export type NutrientRemaining = NutrientTargets

export interface NutritionBudget {
  target: NutrientTargets
  consumed: NutrientVector
  remaining: NutrientRemaining | null
}

/** Per-100g reference row. Mirrors `food_nutrition` column names exactly. */
export interface FoodNutritionPer100g {
  basis_type: string
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
  fiber_g?: number | null
  sodium_mg?: number | null
}

/** A logged food item, in the shape the normalized tables store. */
export interface LoggedFoodItem {
  food_id: number | null
  food_name_raw: string
  food_name_resolved: string | null
  weight_g: number | null
  quantity?: number | null
  unit?: string | null
  is_estimated?: boolean
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
}

export interface CalculationBasis {
  basis_type: string
  per_100g: {
    energy_kcal: number | null
    protein_g: number | null
    carb_g: number | null
    fat_g: number | null
  }
  weight_g: number
  formula: 'per_100g * weight_g / 100'
  /** Rounding applied to persisted values; basis keeps unrounded inputs. */
  rounding: 'none'
}

/**
 * AI Patch §9. Returns `null` when the basis is not per-100g or the weight is
 * unusable, so a caller can distinguish "cannot compute" from "computes to 0".
 *
 * `basis_type` is enforced rather than assumed: a per-100ml or per-serving row
 * must not be silently treated as per-100g.
 */
export function calculateNutrients(
  per100g: FoodNutritionPer100g,
  weightG: number,
): { nutrients: NutrientVector; basis: CalculationBasis } | null {
  if (per100g.basis_type !== 'per_100g') return null
  if (!Number.isFinite(weightG) || weightG <= 0) return null

  const scale = weightG / 100
  const scaleOrNull = (value: number | null | undefined): number | null =>
    value === null || value === undefined ? null : value * scale

  return {
    nutrients: {
      calories_kcal: scaleOrNull(per100g.energy_kcal),
      protein_g: scaleOrNull(per100g.protein_g),
      carbs_g: scaleOrNull(per100g.carb_g),
      fat_g: scaleOrNull(per100g.fat_g),
    },
    basis: {
      basis_type: per100g.basis_type,
      per_100g: {
        energy_kcal: per100g.energy_kcal,
        protein_g: per100g.protein_g,
        carb_g: per100g.carb_g,
        fat_g: per100g.fat_g,
      },
      weight_g: weightG,
      formula: 'per_100g * weight_g / 100',
      rounding: 'none',
    },
  }
}

/**
 * Sums logged items into a consumed vector.
 *
 * Unrounded on purpose: the UI rounds for display, the database keeps the real
 * value so later aggregates do not accrue drift. A small condiment weight
 * (e.g. 5g of soy sauce) must not be lost to display rounding (baseline §2.9).
 */
export function sumConsumed(items: LoggedFoodItem[]): NutrientVector {
  if (items.length === 0) {
    return { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null }
  }

  const sumKnown = (pick: (item: LoggedFoodItem) => number | null): number | null => {
    const values = items.map(pick)
    if (values.some((value) => value === null)) return null
    return values.reduce<number>((total, value) => total + (value as number), 0)
  }

  return {
    calories_kcal: sumKnown((item) => item.energy_kcal),
    protein_g: sumKnown((item) => item.protein_g),
    carbs_g: sumKnown((item) => item.carb_g),
    fat_g: sumKnown((item) => item.fat_g),
  }
}

/**
 * Product §10.1 layer 1. `remaining` is `null` as a whole when no target is set
 * — a partially-null remaining object would invite a caller to render
 * `0 - consumed` against a missing target.
 *
 * Over-target produces negative remaining and is NOT clamped (Product §4.2 /
 * baseline: "超出目标时允许 remaining 为负数，不要偷偷 clamp 为 0").
 */
export function computeNutritionBudget(
  target: NutrientTargets,
  consumed: NutrientVector,
): NutritionBudget {
  const hasAnyTarget = target.calories_kcal !== null
    || target.protein_g !== null
    || target.carbs_g !== null
    || target.fat_g !== null

  if (!hasAnyTarget) {
    return { target, consumed, remaining: null }
  }

  const remaining = (
    targetValue: number | null,
    consumedValue: number | null,
  ): number | null => (
    targetValue === null || consumedValue === null ? null : targetValue - consumedValue
  )

  return {
    target,
    consumed,
    remaining: {
      calories_kcal: remaining(target.calories_kcal, consumed.calories_kcal),
      protein_g: remaining(target.protein_g, consumed.protein_g),
      carbs_g: remaining(target.carbs_g, consumed.carbs_g),
      fat_g: remaining(target.fat_g, consumed.fat_g),
    },
  }
}

/** Rounds for display only. Never persist the rounded value. */
export function roundForDisplay(value: number, digits = 0): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
