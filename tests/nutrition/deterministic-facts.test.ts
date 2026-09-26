import { describe, expect, it } from 'vitest'
import {
  calculateNutrients,
  computeNutritionBudget,
  roundForDisplay,
  sumConsumed,
  type FoodNutritionPer100g,
  type LoggedFoodItem,
  type NutrientTargets,
} from '../../lib/nutrition/types.ts'

/**
 * Phase A verification — deterministic nutrition facts and budget.
 *
 * Fixture source: REAL rows from the repo's own seed data
 * (`supabase/seeds/seed_part1_foods.sql` for names,
 *  `supabase/seeds/seed_part2_nutrition.sql` for per-100g values).
 * Nothing below is invented; the expected numbers are checked against the
 * published seed values so a silent change to the formula fails loudly.
 *
 *   food_id 821  '米饭(蒸,籼米)'  114.0 kcal, 2.5 P, 0.2 F, 25.6 C
 *   food_id 1327 '酱油'            63.0 kcal, 5.6 P, 0.1 F,  9.9 C
 *   food_id 1581 '鸡胸脯肉'       133.0 kcal, 19.4 P, 5.0 F, 2.5 C
 *   food_id 1584 '鸡蛋(白皮)'     138.0 kcal, 12.7 P, 9.0 F, 1.5 C
 */
const CHICKEN_BREAST: FoodNutritionPer100g = {
  basis_type: 'per_100g',
  energy_kcal: 133.0,
  protein_g: 19.4,
  carb_g: 2.5,
  fat_g: 5.0,
}

const STEAMED_RICE: FoodNutritionPer100g = {
  basis_type: 'per_100g',
  energy_kcal: 114.0,
  protein_g: 2.5,
  carb_g: 25.6,
  fat_g: 0.2,
}

const SOY_SAUCE: FoodNutritionPer100g = {
  basis_type: 'per_100g',
  energy_kcal: 63.0,
  protein_g: 5.6,
  carb_g: 9.9,
  fat_g: 0.1,
}

const EGG: FoodNutritionPer100g = {
  basis_type: 'per_100g',
  energy_kcal: 138.0,
  protein_g: 12.7,
  carb_g: 1.5,
  fat_g: 9.0,
}

describe('calculateNutrients (AI Patch §9)', () => {
  it('scales a 150g chicken breast portion from the real seed row', () => {
    const result = calculateNutrients(CHICKEN_BREAST, 150)
    expect(result).not.toBeNull()

    // 19.4 * 1.5 = 29.1 protein, 133 * 1.5 = 199.5 kcal
    expect(result?.nutrients.protein_g).toBeCloseTo(29.1, 6)
    expect(result?.nutrients.calories_kcal).toBeCloseTo(199.5, 6)
    expect(result?.nutrients.carbs_g).toBeCloseTo(3.75, 6)
    expect(result?.nutrients.fat_g).toBeCloseTo(7.5, 6)
  })

  it('records a calculation basis so the number is auditable', () => {
    const result = calculateNutrients(STEAMED_RICE, 200)
    expect(result?.basis.formula).toBe('per_100g * weight_g / 100')
    expect(result?.basis.basis_type).toBe('per_100g')
    expect(result?.basis.weight_g).toBe(200)
    expect(result?.basis.per_100g.energy_kcal).toBe(114.0)
  })

  it('keeps a small condiment weight instead of rounding it away', () => {
    // Baseline §2.9 / Guardrail §11: 5g of soy sauce must not become 0 kcal.
    const result = calculateNutrients(SOY_SAUCE, 5)

    expect(result?.nutrients.calories_kcal).toBeCloseTo(3.15, 6)
    expect(result?.nutrients.calories_kcal).toBeGreaterThan(0)
    // Display rounding is a separate concern and must not touch the stored value.
    expect(roundForDisplay(result!.nutrients.calories_kcal!)).toBe(3)
  })

  it('handles decimal weights without drift', () => {
    const result = calculateNutrients(EGG, 0.5)
    expect(result?.nutrients.calories_kcal).toBeCloseTo(0.69, 6)
    expect(result?.nutrients.protein_g).toBeCloseTo(0.0635, 6)
  })

  it('refuses a non per-100g basis rather than assuming grams', () => {
    // A per-100ml or per-serving row must not be silently treated as grams.
    const perMl = { ...SOY_SAUCE, basis_type: 'per_100ml' }
    expect(calculateNutrients(perMl, 100)).toBeNull()
  })

  it('returns null for unusable weights instead of computing 0', () => {
    // Guardrail §12: "not recorded" must be distinguishable from "zero".
    for (const weight of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(calculateNutrients(CHICKEN_BREAST, weight)).toBeNull()
    }
  })

  it('treats a null macro as absent, not as zero', () => {
    const partial: FoodNutritionPer100g = {
      basis_type: 'per_100g',
      energy_kcal: 100,
      protein_g: null,
      carb_g: 10,
      fat_g: null,
    }
    const result = calculateNutrients(partial, 100)

    expect(result?.nutrients.protein_g).toBeNull()
    // The basis preserves the null so provenance is not lost.
    expect(result?.basis.per_100g.protein_g).toBeNull()
    expect(result?.basis.per_100g.fat_g).toBeNull()
  })
})

describe('sumConsumed', () => {
  const baseItem: LoggedFoodItem = {
    food_id: 1581,
    food_name_raw: '鸡胸脯肉',
    food_name_resolved: '鸡胸脯肉',
    weight_g: 150,
    energy_kcal: 199.5,
    protein_g: 29.1,
    carb_g: 3.75,
    fat_g: 7.5,
  }

  it('totals four macros across a multi-item meal', () => {
    const totals = sumConsumed([
      baseItem,
      { ...baseItem, food_id: 821, food_name_raw: '米饭(蒸,籼米)', weight_g: 200,
        energy_kcal: 228, protein_g: 5, carb_g: 51.2, fat_g: 0.4 },
    ])

    expect(totals.calories_kcal).toBeCloseTo(427.5, 6)
    expect(totals.protein_g).toBeCloseTo(34.1, 6)
    expect(totals.carbs_g).toBeCloseTo(54.95, 6)
    expect(totals.fat_g).toBeCloseTo(7.9, 6)
  })

  it('keeps an unlogged day unknown rather than fabricating zero intake', () => {
    const totals = sumConsumed([])
    expect(totals).toEqual({ calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null })
  })

  it('keeps a missing item macro unknown in the day total', () => {
    const withNulls = { ...baseItem, protein_g: null, fat_g: null }
    const totals = sumConsumed([withNulls])
    expect(totals.protein_g).toBeNull()
    expect(totals.fat_g).toBeNull()
  })
})

describe('computeNutritionBudget (Product §10.1)', () => {
  const target: NutrientTargets = {
    calories_kcal: 1800,
    protein_g: 112,
    carbs_g: 225.5,
    fat_g: 50,
  }

  it('computes remaining = target - consumed', () => {
    const budget = computeNutritionBudget(target, {
      calories_kcal: 427.5,
      protein_g: 34.1,
      carbs_g: 54.95,
      fat_g: 7.9,
    })

    expect(budget.remaining?.calories_kcal).toBeCloseTo(1372.5, 6)
    expect(budget.remaining?.protein_g).toBeCloseTo(77.9, 6)
    expect(budget.remaining?.fat_g).toBeCloseTo(42.1, 6)
  })

  it('preserves negative remaining instead of clamping to zero', () => {
    // Product §4.2 — over-target must stay visible as "已超出 X".
    const budget = computeNutritionBudget(target, {
      calories_kcal: 2100,
      protein_g: 150,
      carbs_g: 100,
      fat_g: 60,
    })

    expect(budget.remaining?.calories_kcal).toBe(-300)
    expect(budget.remaining?.protein_g).toBe(-38)
    expect(budget.remaining?.fat_g).toBe(-10)
  })

  it('returns null remaining when no target is set at all', () => {
    // Product §27 / baseline §3.2: no fabricated target, no fake remaining.
    const noTarget: NutrientTargets = {
      calories_kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    }
    const budget = computeNutritionBudget(noTarget, {
      calories_kcal: 500,
      protein_g: 20,
      carbs_g: 60,
      fat_g: 15,
    })

    expect(budget.remaining).toBeNull()
    // Consumed is still reported so the UI can show it without a target.
    expect(budget.consumed.calories_kcal).toBe(500)
  })

  it('leaves an individual missing target as null while others stay numeric', () => {
    const partial: NutrientTargets = {
      calories_kcal: 1800,
      protein_g: null,
      carbs_g: 225.5,
      fat_g: null,
    }
    const budget = computeNutritionBudget(partial, {
      calories_kcal: 400,
      protein_g: 30,
      carbs_g: 50,
      fat_g: 10,
    })

    expect(budget.remaining?.calories_kcal).toBe(1400)
    expect(budget.remaining?.protein_g).toBeNull()
    expect(budget.remaining?.carbs_g).toBeCloseTo(175.5, 6)
    expect(budget.remaining?.fat_g).toBeNull()
  })

  it('does not claim target remaining when the day has no intake facts', () => {
    const budget = computeNutritionBudget(target, sumConsumed([]))
    expect(budget.remaining?.calories_kcal).toBeNull()
  })
})
