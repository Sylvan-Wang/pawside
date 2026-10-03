export const RECOVERY_SPLIT_COPY = {
  push: { label: '推', muscles: '胸、肩、三头' },
  pull: { label: '拉', muscles: '背、二头' },
  legs: { label: '腿', muscles: '大腿、臀' },
} as const

export type RecoverySplitKey = keyof typeof RECOVERY_SPLIT_COPY

export interface RecoveryWorkoutPrompt {
  days_ago: 1 | 2
  split_key: RecoverySplitKey
  split_label: string
  muscles: string
  same_as_next: boolean
}

export function isRecoverySplitKey(value: string): value is RecoverySplitKey {
  return value in RECOVERY_SPLIT_COPY
}

export function buildRecoveryWorkoutPrompt(input: {
  splitKey: string | null
  logDate: string | null
  today: string
  yesterday: string
  twoDaysAgo: string
  nextSplitKey: string | null
}): RecoveryWorkoutPrompt | null {
  if (!input.splitKey || !isRecoverySplitKey(input.splitKey) || !input.logDate) return null

  const daysAgo = input.logDate === input.yesterday
    ? 1
    : input.logDate === input.twoDaysAgo
      ? 2
      : null
  if (daysAgo === null || input.logDate >= input.today) return null

  const copy = RECOVERY_SPLIT_COPY[input.splitKey]
  return {
    days_ago: daysAgo,
    split_key: input.splitKey,
    split_label: copy.label,
    muscles: copy.muscles,
    same_as_next: input.nextSplitKey === input.splitKey,
  }
}

export function recoveryFollowUp(
  workout: RecoveryWorkoutPrompt | null,
  postWorkoutRecovery: number | null,
): string | null {
  if (!workout?.same_as_next || postWorkoutRecovery !== 1) return null
  return `今天还是练${workout.muscles}，热身时多做一组轻的，先感受一下状态。`
}
