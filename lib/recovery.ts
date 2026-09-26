/**
 * Pawside — Recovery V1 (subjective self-report).
 *
 * Authority:
 *   Product §6.2 — the only two inputs, both 1–5
 *   Product §6.1 — explicitly NOT a sleep product, no recovery score
 *   Product §8   — may only produce the three "自评" descriptions
 *   Product §27  — unanswered is not recorded, never a default such as 3
 *   AI Patch §19 — Evidence D; must never imply a medical conclusion
 *
 * The scale labels live here, in one place, so no caller can invent a
 * "recovery === poor" health judgement (Guardrail §4).
 */

export const SELF_REPORT_MIN = 1
export const SELF_REPORT_MAX = 5
export const SELF_REPORT_SCALE = 5

export type SleepQuality = 1 | 2 | 3 | 4 | 5
export type PostWorkoutRecovery = 1 | 2 | 3 | 4 | 5

export interface RecoveryCheckin {
  checkin_date: string
  sleep_quality_self_report: number | null
  post_workout_recovery_self_report: number | null
  skipped: boolean
}

/** Product §7.1 — the answer labels shown on the popup. */
export const SELF_REPORT_LABELS: Record<number, string> = {
  1: '很差',
  2: '较差',
  3: '一般',
  4: '不错',
  5: '很好',
}

/**
 * Product §8: the ONLY permitted descriptions of these values.
 *
 * Source: Product Patch §8 ("允许的基础表达只有") and AI Patch §19
 * ("1–2 → 自评偏低 / 3 → 自评一般 / 4–5 → 自评较好").
 *
 * Deliberately returns `null` for an unanswered value so callers render
 * "未记录" instead of a fake "一般" (Product §27).
 */
export function describeSelfReport(value: number | null): string | null {
  if (value === null) return null
  if (value <= 2) return '自评偏低'
  if (value === 3) return '自评一般'
  return '自评较好'
}

export function isValidSelfReport(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= SELF_REPORT_MIN
    && value <= SELF_REPORT_MAX
}

/**
 * Claims this module is allowed to make. Kept as an exported constant so a
 * reviewer (or a test) can assert the forbidden set is never introduced.
 *
 * AI Patch §19 forbids: 医学恢复不良 / 过度训练 / 睡眠障碍.
 * Product §8 forbids: 今天禁止训练 / 训练量必须降低 X% / 你过度训练了.
 */
export const FORBIDDEN_RECOVERY_CLAIMS = [
  '医学恢复不良',
  '过度训练',
  '睡眠障碍',
  '今天禁止训练',
  '训练量必须降低',
] as const

export interface RecoveryTrend {
  /** Mean of answered sleep reports, or null when unanswered. */
  average_sleep: number | null
  /** Mean of answered recovery reports, or null when unanswered. */
  average_post_workout_recovery: number | null
  answered_days: number
  /** Product §23.4: show how many days contributed, and no composite score. */
  total_days: number
}

/**
 * Product §23.4 weekly recovery trend.
 *
 * Averages are computed over ANSWERED days only, and `total_days` is returned
 * alongside so the UI can express thin data honestly. There is deliberately no
 * combined "recovery score" (Product §6.1 / §23.4).
 */
export function computeRecoveryTrend(checkins: RecoveryCheckin[]): RecoveryTrend {
  const sleep = checkins
    .map((entry) => entry.sleep_quality_self_report)
    .filter((value): value is number => value !== null)
  const recovery = checkins
    .map((entry) => entry.post_workout_recovery_self_report)
    .filter((value): value is number => value !== null)

  const answeredDays = checkins.filter((entry) =>
    entry.sleep_quality_self_report !== null || entry.post_workout_recovery_self_report !== null,
  ).length

  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10

  return {
    average_sleep: mean(sleep),
    average_post_workout_recovery: mean(recovery),
    answered_days: answeredDays,
    total_days: checkins.length,
  }
}

/** Product §7: the check-in is offered once per local natural day. */
export function shouldPromptCheckin(
  todayCheckin: RecoveryCheckin | null | undefined,
): boolean {
  if (!todayCheckin) return true
  // Answered or explicitly skipped both count as "already handled today",
  // so closing the app must not re-prompt (Product §7).
  return false
}
