import { describe, expect, it } from 'vitest'
import { buildMealCalorieRanges, buildTodayGuidance, describeRemaining } from '../../lib/nutrition/guidance'

describe('nutrition guidance', () => {
  it('builds non-binding meal ranges from the daily target', () => {
    expect(buildMealCalorieRanges(2000)).toEqual({
      breakfast: [500, 600],
      lunch: [600, 800],
      dinner: [600, 700],
    })
  })

  it('hides meal guidance when the target is missing', () => {
    expect(buildMealCalorieRanges(null)).toBeNull()
    expect(buildTodayGuidance({
      calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null,
    }).mealRanges).toBeNull()
  })

  it('preserves over-target semantics instead of clamping', () => {
    expect(describeRemaining(-12, 'g')).toBe('已超过参考 12 g')
    expect(describeRemaining(104, 'g')).toBe('还可参考摄入 104 g')
  })
})
