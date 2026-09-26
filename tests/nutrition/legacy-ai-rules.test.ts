import { describe, expect, it } from 'vitest'
import { evaluateCalories, type UserProfile } from '../../lib/ai-rules.ts'

const profile: UserProfile = {
  goal: 'lose_fat',
  gender: 'female',
  height_cm: 168,
  weight_kg: 65,
  weekly_workout_target: 4,
  daily_calorie_target: null,
}

describe('legacy calorie preprocessing compatibility', () => {
  it('does not recreate a weight-times-31 target when the user has no target', () => {
    expect(evaluateCalories(1800, profile, 65)).toBe('no_target')
  })

  it('compares only against an explicit target', () => {
    expect(evaluateCalories(1800, { ...profile, daily_calorie_target: 1800 }, 65)).toBe('on_target')
  })
})
