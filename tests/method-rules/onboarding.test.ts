import { describe, expect, it } from 'vitest'
import { parseOnboardingInput } from '../../lib/contracts/onboarding.ts'

const validInput = {
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

describe('Phase 2 onboarding contract', () => {
  it('accepts a complete lightweight capability profile', () => {
    const result = parseOnboardingInput(validInput)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.capability_profile?.equipment_access).toBe('full_gym')
      expect(result.data.join_method).toBe(true)
    }
  })

  it('does not allow Method enrollment without capability answers', () => {
    const result = parseOnboardingInput({
      ...validInput,
      capability_profile: null,
    })

    expect(result).toEqual(expect.objectContaining({ success: false }))
  })

  it('rejects unsupported session durations', () => {
    const result = parseOnboardingInput({
      ...validInput,
      capability_profile: {
        ...validInput.capability_profile,
        preferred_session_minutes: 75,
      },
    })

    expect(result).toEqual(expect.objectContaining({ success: false }))
  })

  it('keeps legacy base-only payloads valid when enrollment is not requested', () => {
    const result = parseOnboardingInput({
      goal: 'maintain',
      gender: 'other',
      height_cm: 165,
      reference_weight_kg: 60,
      weight_unit: 'kg',
    })

    expect(result).toEqual(expect.objectContaining({ success: true }))
  })
})
