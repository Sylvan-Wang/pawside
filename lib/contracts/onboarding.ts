export const ONBOARDING_VERSION = '2.0-phase2'

export const onboardingGoals = ['gain_muscle', 'lose_fat', 'maintain'] as const
export const onboardingGenders = ['male', 'female', 'other'] as const
export const onboardingWeightUnits = ['kg', 'lb'] as const
export const trainingExperiences = [
  'new_to_structured',
  'some_experience',
  'consistent',
] as const
export const pushupCapacities = [
  'not_yet',
  'one_to_five',
  'six_to_fifteen',
  'sixteen_plus',
  'unsure',
] as const
export const equipmentAccessOptions = [
  'full_gym',
  'basic_equipment',
  'home_bodyweight',
] as const
export const preferredSessionMinutesOptions = [30, 45, 60, 90] as const

export type OnboardingGoal = (typeof onboardingGoals)[number]
export type OnboardingGender = (typeof onboardingGenders)[number]
export type OnboardingWeightUnit = (typeof onboardingWeightUnits)[number]
export type TrainingExperience = (typeof trainingExperiences)[number]
export type PushupCapacity = (typeof pushupCapacities)[number]
export type EquipmentAccess = (typeof equipmentAccessOptions)[number]
export type PreferredSessionMinutes = (typeof preferredSessionMinutesOptions)[number]

export interface CapabilityProfileInput {
  training_experience: TrainingExperience
  pushup_capacity: PushupCapacity
  equipment_access: EquipmentAccess
  preferred_session_minutes: PreferredSessionMinutes
}

export interface OnboardingInput {
  goal: OnboardingGoal
  gender: OnboardingGender
  height_cm: number
  reference_weight_kg: number
  weight_unit: OnboardingWeightUnit
  capability_profile: CapabilityProfileInput | null
  join_method: boolean
}

type ValidationResult =
  | { success: true; data: OnboardingInput }
  | { success: false; issues: string[] }

export function parseOnboardingInput(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, issues: ['请求内容必须是对象'] }
  }

  const input = value as Record<string, unknown>
  const issues: string[] = []

  if (!onboardingGoals.includes(input.goal as OnboardingGoal)) {
    issues.push('goal 必须是 gain_muscle、lose_fat 或 maintain')
  }
  if (!onboardingGenders.includes(input.gender as OnboardingGender)) {
    issues.push('gender 必须是 male、female 或 other')
  }
  if (
    typeof input.height_cm !== 'number' ||
    !Number.isFinite(input.height_cm) ||
    input.height_cm <= 0 ||
    input.height_cm > 300
  ) {
    issues.push('height_cm 必须是 0 到 300 之间的有效数字')
  }
  if (
    typeof input.reference_weight_kg !== 'number' ||
    !Number.isFinite(input.reference_weight_kg) ||
    input.reference_weight_kg <= 0 ||
    input.reference_weight_kg > 500
  ) {
    issues.push('reference_weight_kg 必须是 0 到 500 之间的有效数字')
  }
  if (!onboardingWeightUnits.includes(input.weight_unit as OnboardingWeightUnit)) {
    issues.push('weight_unit 必须是 kg 或 lb')
  }
  if (input.join_method !== undefined && typeof input.join_method !== 'boolean') {
    issues.push('join_method 必须是布尔值')
  }

  let capabilityProfile: CapabilityProfileInput | null = null
  if (input.capability_profile !== undefined && input.capability_profile !== null) {
    if (
      typeof input.capability_profile !== 'object' ||
      Array.isArray(input.capability_profile)
    ) {
      issues.push('capability_profile 必须是对象')
    } else {
      const capability = input.capability_profile as Record<string, unknown>
      if (!trainingExperiences.includes(capability.training_experience as TrainingExperience)) {
        issues.push('training_experience 无效')
      }
      if (!pushupCapacities.includes(capability.pushup_capacity as PushupCapacity)) {
        issues.push('pushup_capacity 无效')
      }
      if (!equipmentAccessOptions.includes(capability.equipment_access as EquipmentAccess)) {
        issues.push('equipment_access 无效')
      }
      if (
        !preferredSessionMinutesOptions.includes(
          capability.preferred_session_minutes as PreferredSessionMinutes,
        )
      ) {
        issues.push('preferred_session_minutes 必须是 30、45、60 或 90')
      }

      capabilityProfile = {
        training_experience: capability.training_experience as TrainingExperience,
        pushup_capacity: capability.pushup_capacity as PushupCapacity,
        equipment_access: capability.equipment_access as EquipmentAccess,
        preferred_session_minutes:
          capability.preferred_session_minutes as PreferredSessionMinutes,
      }
    }
  }

  if (input.join_method === true && capabilityProfile === null) {
    issues.push('加入训练方法前必须完成轻量能力画像')
  }

  if (issues.length > 0) return { success: false, issues }

  return {
    success: true,
    data: {
      goal: input.goal as OnboardingGoal,
      gender: input.gender as OnboardingGender,
      height_cm: input.height_cm as number,
      reference_weight_kg: input.reference_weight_kg as number,
      weight_unit: input.weight_unit as OnboardingWeightUnit,
      capability_profile: capabilityProfile,
      join_method: input.join_method === true,
    },
  }
}
