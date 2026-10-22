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
      return '你的器械还没有默认的训练方法，请在「训练方法」里选一个适合你的。你仍可记录自由训练。'
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

/** Same vocabulary as onboarding's `equipment_access`, ordered from least to most equipment. */
export const methodEquipmentLevels = ['home_bodyweight', 'basic_equipment', 'full_gym'] as const
export type MethodEquipmentLevel = (typeof methodEquipmentLevels)[number]

const EQUIPMENT_LABEL: Record<MethodEquipmentLevel, string> = {
  home_bodyweight: '徒手即可',
  basic_equipment: '哑铃等基础器械',
  full_gym: '健身房器械',
}

export function isMethodEquipmentLevel(value: unknown): value is MethodEquipmentLevel {
  return typeof value === 'string' && (methodEquipmentLevels as readonly string[]).includes(value)
}

export interface MethodEquipmentFit {
  fit: 'available' | 'needs_confirmation'
  requirement_label: string
  message: string | null
}

/**
 * Whether a user's equipment satisfies what a method needs. A method the user does not
 * fully match is still listed; the caller shows it greyed out and asks for confirmation.
 * An unset or unknown user equipment is treated as bodyweight-only (it is never read as
 * "confirmed no equipment" anywhere else).
 */
export function evaluateMethodEquipmentFit(
  userEquipment: string | null | undefined,
  required: string | null | undefined,
): MethodEquipmentFit {
  const need: MethodEquipmentLevel = isMethodEquipmentLevel(required) ? required : 'full_gym'
  const have: MethodEquipmentLevel = isMethodEquipmentLevel(userEquipment) ? userEquipment : 'home_bodyweight'
  const requirement_label = EQUIPMENT_LABEL[need]
  const ok = methodEquipmentLevels.indexOf(have) >= methodEquipmentLevels.indexOf(need)
  return {
    fit: ok ? 'available' : 'needs_confirmation',
    requirement_label,
    message: ok ? null : `该方法需要${requirement_label}才能执行，确定切换吗？`,
  }
}
