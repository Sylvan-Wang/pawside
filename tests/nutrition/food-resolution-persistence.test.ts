import { describe, expect, it } from 'vitest'
import {
  deriveItemForPersistence,
  type FoodItemInput,
} from '../../lib/nutrition/persistence'

const base: FoodItemInput = {
  food_id: null,
  food_name_raw: '巧克力奶',
  food_name_resolved: '巧克力奶',
  weight_g: 200,
  per100g: null,
  resolution_source: 'user_override',
  source_ref_id: null,
  user_confirmed: false,
  fallback: {
    calories_kcal: 150,
    protein_g: 6.4,
    carbs_g: 23,
    fat_g: 4.2,
  },
}

describe('food resolution persistence gate', () => {
  it('rejects an unresolved/unconfirmed fallback', () => {
    expect(() => deriveItemForPersistence(base, null)).toThrow('还缺少营养信息')
  })

  it('persists an explicit user override without promoting it to canonical', () => {
    const result = deriveItemForPersistence({ ...base, user_confirmed: true }, null)
    expect(result.row.energy_kcal).toBe(150)
    expect(result.isEstimated).toBe(false)
    expect(result.calculationBasis).toMatchObject({
      basis_type: 'confirmed_actual',
      resolution_source: 'user_override',
      user_confirmed: true,
    })
  })

  it('marks confirmed AI nutrition as estimated while computing deterministically', () => {
    const result = deriveItemForPersistence({
      ...base,
      resolution_source: 'ai_estimate',
      source_ref_id: 'candidate-1',
      user_confirmed: true,
      fallback: undefined,
    }, {
      basis_type: 'per_100g',
      energy_kcal: 75,
      protein_g: 3.2,
      carb_g: 11.5,
      fat_g: 2.1,
    })
    expect(result.row.energy_kcal).toBe(150)
    expect(result.isEstimated).toBe(true)
    expect(result.calculationBasis).toMatchObject({
      formula: 'per_100g * weight_g / 100',
      resolution_source: 'ai_estimate',
      source_ref_id: 'candidate-1',
    })
  })
})
