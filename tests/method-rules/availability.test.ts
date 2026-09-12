import { describe, expect, it } from 'vitest'
import { evaluateMethodAvailability } from '../../lib/method-availability'

describe('Method availability', () => {
  it('offers enrollment only to an onboarded full-gym user with an active release', () => {
    expect(evaluateMethodAvailability({
      onboardingCompleted: true,
      capabilityProfileExists: true,
      equipmentAccess: 'full_gym',
      releaseAvailable: true,
    })).toMatchObject({ status: 'available', reason: 'NOT_ENROLLED' })
  })

  it('keeps incomplete onboarding distinct from a missing capability profile', () => {
    expect(evaluateMethodAvailability({
      onboardingCompleted: false,
      capabilityProfileExists: false,
      equipmentAccess: null,
      releaseAvailable: true,
    }).reason).toBe('ONBOARDING_INCOMPLETE')

    expect(evaluateMethodAvailability({
      onboardingCompleted: true,
      capabilityProfileExists: false,
      equipmentAccess: null,
      releaseAvailable: true,
    }).reason).toBe('CAPABILITY_PROFILE_MISSING')
  })

  it.each(['basic_equipment', 'home_bodyweight'])('blocks unsupported equipment: %s', (equipmentAccess) => {
    expect(evaluateMethodAvailability({
      onboardingCompleted: true,
      capabilityProfileExists: true,
      equipmentAccess,
      releaseAvailable: true,
    })).toMatchObject({ status: 'unavailable', reason: 'EQUIPMENT_REVIEW_REQUIRED' })
  })

  it('reports release readiness only after user eligibility passes', () => {
    expect(evaluateMethodAvailability({
      onboardingCompleted: true,
      capabilityProfileExists: true,
      equipmentAccess: 'full_gym',
      releaseAvailable: false,
    })).toMatchObject({ status: 'unavailable', reason: 'METHOD_NOT_READY' })
  })
})
