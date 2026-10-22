import { describe, expect, it } from 'vitest'
import { evaluateMethodAvailability, evaluateMethodEquipmentFit } from '../../lib/method-availability'

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

describe('Method equipment fit', () => {
  it('lets a full-gym user use every method', () => {
    for (const required of ['home_bodyweight', 'basic_equipment', 'full_gym']) {
      expect(evaluateMethodEquipmentFit('full_gym', required).fit).toBe('available')
    }
  })

  it('greys out methods that need more equipment than the user has', () => {
    expect(evaluateMethodEquipmentFit('basic_equipment', 'home_bodyweight').fit).toBe('available')
    expect(evaluateMethodEquipmentFit('basic_equipment', 'basic_equipment').fit).toBe('available')
    expect(evaluateMethodEquipmentFit('basic_equipment', 'full_gym')).toMatchObject({
      fit: 'needs_confirmation',
      message: '该方法需要健身房器械才能执行，确定切换吗？',
    })
    expect(evaluateMethodEquipmentFit('home_bodyweight', 'basic_equipment')).toMatchObject({
      fit: 'needs_confirmation',
      message: '该方法需要哑铃等基础器械才能执行，确定切换吗？',
    })
    expect(evaluateMethodEquipmentFit('home_bodyweight', 'home_bodyweight').fit).toBe('available')
  })

  it('treats unset equipment as bodyweight only and an unknown requirement as a full gym', () => {
    expect(evaluateMethodEquipmentFit(null, 'home_bodyweight').fit).toBe('available')
    expect(evaluateMethodEquipmentFit(null, 'basic_equipment').fit).toBe('needs_confirmation')
    expect(evaluateMethodEquipmentFit('basic_equipment', undefined).fit).toBe('needs_confirmation')
  })
})
