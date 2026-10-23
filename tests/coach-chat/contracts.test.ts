import { describe, expect, it } from 'vitest'
import { createFoodLogBodySchema, replaceFoodLogBodySchema } from '../../lib/nutrition/api-contracts'

const base = {
  request_id: '3f2b8c1e-0a4d-4f5e-9a7b-1c2d3e4f5a6b',
  date: '2026-10-22',
  meal_type: 'lunch',
}
const item = {
  food_name_raw: '米饭',
  weight_g: 200,
  resolution_source: 'canonical_db',
  user_confirmed: true,
  per100g: null,
}

describe('browser-facing food log contracts', () => {
  it('strips server-only fields, so a request body cannot supply trusted numbers or skip nutrition', () => {
    const parsed = createFoodLogBodySchema.parse({
      ...base,
      items: [{
        ...item,
        resolution_source: 'ai_estimate',
        provisional_per100g: { basis_type: 'per_100g', energy_kcal: 1, protein_g: 1, carb_g: 1, fat_g: 1 },
        nutrition_unknown: true,
      }],
    })
    expect(parsed.items[0]).not.toHaveProperty('provisional_per100g')
    expect(parsed.items[0]).not.toHaveProperty('nutrition_unknown')
  })

  it('create still requires a positive weight (raw-only is not creatable from the browser)', () => {
    expect(createFoodLogBodySchema.safeParse({ ...base, items: [{ ...item, weight_g: null, nutrition_unknown: true }] }).success).toBe(false)
    expect(createFoodLogBodySchema.safeParse({ ...base, items: [{ ...item, weight_g: 0 }] }).success).toBe(false)
  })

  it('edit allows a raw-only item only when it carries no weight', () => {
    const rawOnly = { ...item, weight_g: null, nutrition_unknown: true }
    expect(replaceFoodLogBodySchema.safeParse({ ...base, items: [rawOnly] }).success).toBe(true)
    // missing weight without the flag, and a weighed item flagged unknown: both refused
    expect(replaceFoodLogBodySchema.safeParse({ ...base, items: [{ ...item, weight_g: null }] }).success).toBe(false)
    expect(replaceFoodLogBodySchema.safeParse({ ...base, items: [{ ...item, nutrition_unknown: true }] }).success).toBe(false)
    expect(replaceFoodLogBodySchema.safeParse({ ...base, items: [item] }).success).toBe(true)
  })
})
