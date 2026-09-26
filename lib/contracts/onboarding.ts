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

/**
 * Source: Product Patch §4 — the user sets the daily calorie target themselves.
 * The bound is a tamper guard, not a safety threshold: AI Patch §14 /
 * E-NUT-SAFE-001 establish that this product has no universal calorie floor,
 * so no lower "danger" limit may be encoded here.
 */
export const dailyCalorieTargetBounds = { min: 500, max: 20000 } as const

/**
 * Source: Product Patch §3.1 / §2 Layer 1 — weekly training target is a Target
 * layer input. Bounds are a tamper guard only; they are not an adherence rule.
 */
export const weeklyWorkoutTargetBounds = { min: 1, max: 21 } as const

/**
 * Hard ceiling used by the SQL contract for `daily_calorie_target`.
 *
 * The SQL function uses `numeric(10,2)`, which allows values far beyond any
 * plausible calorie target. The database guard is therefore a tamper ceiling,
 * not a product or safety threshold: AI Patch §14 / E-NUT-SAFE-001 establish
 * that Pawside has no universal calorie floor, so no lower "danger" bound is
 * encoded here. Keep in sync with `dailyCalorieTargetBounds.max`.
 */
export const DAILY_CALORIE_TARGET_SQL_CEILING = 20000

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
  /**
   * Product Patch §4: the only nutrition target the user must set themselves.
   * `null` is a legitimate, representable state — Product Patch §27 requires the
   * UI to show consumed without a fabricated target, and baseline §3.2 requires
   * missing target to stay `null` rather than defaulting to a number.
   */
  daily_calorie_target: number | null
  weekly_workout_target: number | null
  capability_profile: CapabilityProfileInput | null
  join_method: boolean
  time_zone: string
}

type ValidationResult =
  | { success: true; data: OnboardingInput }
  | { success: false; issues: string[] }

/**
 * Parses a Target-layer numeric field that may legitimately be absent.
 *
 * Distinct states (Guardrail §12):
 *   absent / null / ''      -> null  (not recorded, never coerced to a default)
 *   non-numeric junk        -> issue (rejected)
 *   outside bounds          -> issue (includes 0 and negatives)
 *   valid number            -> number
 *
 * Source: Product Patch §4 (user sets calories), §27 (target may be unset).
 */
function parseOptionalTarget(
  value: unknown,
  bounds: { min: number; max: number },
  fieldName: string,
  issues: string[],
): number | null {
  if (value === undefined || value === null || value === '') return null

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`${fieldName} 必须是数字，或留空表示未设置`)
    return null
  }
  if (value < bounds.min || value > bounds.max) {
    issues.push(`${fieldName} 必须在 ${bounds.min} 到 ${bounds.max} 之间`)
    return null
  }
  return value
}

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

  /**
   * Target layer fields. Both accept `null` / omitted to mean "not set", which
   * must remain distinct from `0` (Guardrail §12). We never substitute a default
   * here — see Guardrail §2.2 and baseline §3.2.
   */
  const dailyCalorieTarget = parseOptionalTarget(
    input.daily_calorie_target,
    dailyCalorieTargetBounds,
    'daily_calorie_target',
    issues,
  )
  const weeklyWorkoutTarget = parseOptionalTarget(
    input.weekly_workout_target,
    weeklyWorkoutTargetBounds,
    'weekly_workout_target',
    issues,
  )
  if (input.join_method !== undefined && typeof input.join_method !== 'boolean') {
    issues.push('join_method 必须是布尔值')
  }

  const timeZone = typeof input.time_zone === 'string' && input.time_zone.trim()
    ? input.time_zone.trim()
    : 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
  } catch {
    issues.push('time_zone 必须是有效的 IANA 时区')
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
      daily_calorie_target: dailyCalorieTarget,
      weekly_workout_target: weeklyWorkoutTarget,
      capability_profile: capabilityProfile,
      join_method: input.join_method === true,
      time_zone: timeZone,
    },
  }
}
