import { describe, expect, it } from 'vitest'
import { actualToPer100g, isCompleteNutrition, normalizeFoodName, resolutionLabel } from '../../lib/nutrition/food-resolution'

describe('food resolution', () => {
  it('normalizes aliases without inventing food identity', () => {
    expect(normalizeFoodName(' 巧克力 奶 ')).toBe('巧克力奶')
  })

  it('converts a confirmed serving to a deterministic per-100g basis', () => {
    expect(actualToPer100g({
      weightG: 200, energyKcal: 150, proteinG: 6.4, carbG: 23, fatG: 4.2,
    })).toMatchObject({ energy_kcal: 75, protein_g: 3.2, carb_g: 11.5, fat_g: 2.1 })
  })

  it('requires all four core nutrients before confirmation', () => {
    expect(isCompleteNutrition({ energy_kcal: 150, protein_g: 6, carb_g: 23, fat_g: null })).toBe(false)
    expect(resolutionLabel('user_override')).toBe('你填写的')
  })
})
