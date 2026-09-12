export type MethodAvailabilityReason =
  | 'NOT_ENROLLED'
  | 'ONBOARDING_INCOMPLETE'
  | 'CAPABILITY_PROFILE_MISSING'
  | 'EQUIPMENT_REVIEW_REQUIRED'
  | 'METHOD_NOT_READY'

export interface MethodEligibilityInput {
  onboardingCompleted: boolean
  capabilityProfileExists: boolean
  equipmentAccess: string | null
  releaseAvailable: boolean
}

export interface MethodAvailabilityResult {
  status: 'available' | 'unavailable'
  reason: MethodAvailabilityReason
  message: string
}

export function methodAvailabilityMessage(reason: MethodAvailabilityReason) {
  switch (reason) {
    case 'ONBOARDING_INCOMPLETE':
      return '请先完成基础设置，之后即可启用三分化。'
    case 'CAPABILITY_PROFILE_MISSING':
      return '请先完成轻量能力画像，之后即可启用三分化。'
    case 'EQUIPMENT_REVIEW_REQUIRED':
      return '当前三分化仅支持完整健身房器械。你仍可记录自由训练，或修改训练条件。'
    case 'METHOD_NOT_READY':
      return '官方训练方法仍在发布校验中，基础设置和自由训练不受影响。'
    case 'NOT_ENROLLED':
      return '三分化已经准备好，可以从「推」开始。'
  }
}

export function evaluateMethodAvailability(input: MethodEligibilityInput): MethodAvailabilityResult {
  const reason: MethodAvailabilityReason = !input.onboardingCompleted
    ? 'ONBOARDING_INCOMPLETE'
    : !input.capabilityProfileExists
      ? 'CAPABILITY_PROFILE_MISSING'
      : input.equipmentAccess !== 'full_gym'
        ? 'EQUIPMENT_REVIEW_REQUIRED'
        : !input.releaseAvailable
          ? 'METHOD_NOT_READY'
          : 'NOT_ENROLLED'

  return {
    status: reason === 'NOT_ENROLLED' ? 'available' : 'unavailable',
    reason,
    message: methodAvailabilityMessage(reason),
  }
}
