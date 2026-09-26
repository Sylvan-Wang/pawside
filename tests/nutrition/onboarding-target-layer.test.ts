import { describe, expect, it } from 'vitest'
import {
  dailyCalorieTargetBounds,
  parseOnboardingInput,
  weeklyWorkoutTargetBounds,
} from '../../lib/contracts/onboarding.ts'

/**
 * Phase 0 verification — Target layer contract (Product Patch §4, §27).
 *
 * The critical property under test is Guardrail §12: `0`, `null`, absent, and
 * out-of-range must remain distinguishable, and absent must NEVER be coerced to
 * a default. Baseline §3.2 requires a missing target to stay null rather than
 * becoming 2000 / 3.
 */
const baseInput = {
  goal: 'gain_muscle',
  gender: 'male',
  height_cm: 178,
  reference_weight_kg: 72,
  weight_unit: 'kg',
  capability_profile: {
    training_experience: 'some_experience',
    pushup_capacity: 'six_to_fifteen',
    equipment_access: 'full_gym',
    preferred_session_minutes: 60,
  },
  join_method: true,
}

function parseTargets(overrides: Record<string, unknown>) {
  const result = parseOnboardingInput({ ...baseInput, ...overrides })
  if (!result.success) throw new Error(`expected success, got issues: ${result.issues.join('; ')}`)
  return result.data
}

describe('onboarding target layer contract', () => {
  it('treats an omitted calorie target as null, not as a default', () => {
    const data = parseTargets({})
    expect(data.daily_calorie_target).toBeNull()
    expect(data.weekly_workout_target).toBeNull()
  })

  it('treats explicit null as null', () => {
    const data = parseTargets({ daily_calorie_target: null, weekly_workout_target: null })
    expect(data.daily_calorie_target).toBeNull()
    expect(data.weekly_workout_target).toBeNull()
  })

  it('treats an empty string as not-recorded', () => {
    const data = parseTargets({ daily_calorie_target: '', weekly_workout_target: '' })
    expect(data.daily_calorie_target).toBeNull()
    expect(data.weekly_workout_target).toBeNull()
  })

  it('preserves a valid calorie target exactly', () => {
    const data = parseTargets({ daily_calorie_target: 1800, weekly_workout_target: 4 })
    expect(data.daily_calorie_target).toBe(1800)
    expect(data.weekly_workout_target).toBe(4)
  })

  it('rejects 0 instead of silently reading it as "not set"', () => {
    // Guardrail §12: 0 and missing must not be interchangeable.
    const result = parseOnboardingInput({ ...baseInput, daily_calorie_target: 0 })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join(' ')).toContain('daily_calorie_target')
    }
  })

  it('rejects 0 for the weekly target too', () => {
    const result = parseOnboardingInput({ ...baseInput, weekly_workout_target: 0 })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join(' ')).toContain('weekly_workout_target')
    }
  })

  it('rejects a non-numeric calorie target rather than coercing it', () => {
    const result = parseOnboardingInput({ ...baseInput, daily_calorie_target: '1800' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join(' ')).toContain('daily_calorie_target')
    }
  })

  it('rejects targets outside the tamper bounds', () => {
    const tooLow = parseOnboardingInput({
      ...baseInput,
      daily_calorie_target: dailyCalorieTargetBounds.min - 1,
    })
    const tooHigh = parseOnboardingInput({
      ...baseInput,
      weekly_workout_target: weeklyWorkoutTargetBounds.max + 1,
    })

    expect(tooLow.success).toBe(false)
    expect(tooHigh.success).toBe(false)
  })

  it('accepts the boundary values themselves', () => {
    const atMin = parseTargets({ daily_calorie_target: dailyCalorieTargetBounds.min })
    const atMax = parseTargets({ weekly_workout_target: weeklyWorkoutTargetBounds.max })

    expect(atMin.daily_calorie_target).toBe(dailyCalorieTargetBounds.min)
    expect(atMax.weekly_workout_target).toBe(weeklyWorkoutTargetBounds.max)
  })

  it('encodes no lower safety floor beyond the tamper bound', () => {
    // AI Patch §14 / E-NUT-SAFE-001: no universal calorie floor exists.
    // 1200 and 1000 kcal are above the tamper minimum, so they must be accepted
    // as user choices rather than rejected as "dangerous".
    for (const kcal of [1000, 1200, 1500]) {
      const data = parseTargets({ daily_calorie_target: kcal })
      expect(data.daily_calorie_target).toBe(kcal)
    }
  })
})
