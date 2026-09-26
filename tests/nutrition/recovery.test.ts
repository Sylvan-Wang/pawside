import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_RECOVERY_CLAIMS,
  computeRecoveryTrend,
  describeSelfReport,
  isValidSelfReport,
  shouldPromptCheckin,
  type RecoveryCheckin,
} from '../../lib/recovery.ts'

/**
 * Phase B verification — Recovery V1 (Product §6–§8, AI Patch §19).
 *
 * The most important assertions here are the NEGATIVE ones: the three allowed
 * descriptions must be the only vocabulary, and no medical claim may appear.
 */
describe('recovery self-report vocabulary (Product §8)', () => {
  it('maps the scale to the three permitted descriptions', () => {
    expect(describeSelfReport(1)).toBe('自评偏低')
    expect(describeSelfReport(2)).toBe('自评偏低')
    expect(describeSelfReport(3)).toBe('自评一般')
    expect(describeSelfReport(4)).toBe('自评较好')
    expect(describeSelfReport(5)).toBe('自评较好')
  })

  it('returns null for an unanswered value instead of a default', () => {
    // Product §27: "今日未记录主观恢复" — never a substituted 一般/3.
    expect(describeSelfReport(null)).toBeNull()
  })

  it('never emits a medical or training-decision claim', () => {
    // AI Patch §19 / Product §8 explicitly forbid these.
    const everyPossibleOutput = [1, 2, 3, 4, 5, null]
      .map((value) => describeSelfReport(value))
      .filter((value): value is string => value !== null)

    for (const forbidden of FORBIDDEN_RECOVERY_CLAIMS) {
      for (const output of everyPossibleOutput) {
        expect(output).not.toContain(forbidden)
      }
    }
  })

  it('accepts only integers 1 through 5', () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isValidSelfReport(value)).toBe(true)
    // Guardrail §12: out-of-scale is rejected, never clamped.
    for (const value of [0, 6, -1, 2.5, '3', null, undefined]) {
      expect(isValidSelfReport(value)).toBe(false)
    }
  })
})

describe('recovery check-in trigger (Product §7)', () => {
  it('prompts when today has no check-in', () => {
    expect(shouldPromptCheckin(null)).toBe(true)
    expect(shouldPromptCheckin(undefined)).toBe(true)
  })

  it('does not re-prompt after an answered check-in', () => {
    const answered: RecoveryCheckin = {
      checkin_date: '2026-09-26',
      sleep_quality_self_report: 4,
      post_workout_recovery_self_report: 3,
      skipped: false,
    }
    expect(shouldPromptCheckin(answered)).toBe(false)
  })

  it('does not re-prompt after an explicit skip', () => {
    // Product §7: closing the app must not re-trigger the popup.
    const skipped: RecoveryCheckin = {
      checkin_date: '2026-09-26',
      sleep_quality_self_report: null,
      post_workout_recovery_self_report: null,
      skipped: true,
    }
    expect(shouldPromptCheckin(skipped)).toBe(false)
  })
})

describe('recovery trend (Product §23.4)', () => {
  it('averages only answered days and reports how many answered', () => {
    const checkins: RecoveryCheckin[] = [
      { checkin_date: '2026-09-22', sleep_quality_self_report: 4, post_workout_recovery_self_report: 3, skipped: false },
      { checkin_date: '2026-09-23', sleep_quality_self_report: 2, post_workout_recovery_self_report: null, skipped: false },
      { checkin_date: '2026-09-24', sleep_quality_self_report: null, post_workout_recovery_self_report: null, skipped: true },
      { checkin_date: '2026-09-25', sleep_quality_self_report: 3, post_workout_recovery_self_report: 5, skipped: false },
    ]

    const trend = computeRecoveryTrend(checkins)

    // sleep answered on 3 days: (4+2+3)/3 = 3
    expect(trend.average_sleep).toBe(3)
    // recovery answered on 2 days: (3+5)/2 = 4
    expect(trend.average_post_workout_recovery).toBe(4)
    expect(trend.answered_days).toBe(3)
    // total_days lets the UI express thin data honestly.
    expect(trend.total_days).toBe(4)
  })

  it('returns null averages when nothing was answered', () => {
    const trend = computeRecoveryTrend([
      { checkin_date: '2026-09-25', sleep_quality_self_report: null, post_workout_recovery_self_report: null, skipped: true },
    ])

    expect(trend.average_sleep).toBeNull()
    expect(trend.average_post_workout_recovery).toBeNull()
    expect(trend.answered_days).toBe(0)
  })

  it('exposes no composite recovery score', () => {
    // Product §6.1 / §23.4 forbid a single "恢复分".
    const trend = computeRecoveryTrend([])
    expect(Object.keys(trend).sort()).toEqual([
      'answered_days',
      'average_post_workout_recovery',
      'average_sleep',
      'total_days',
    ])
  })
})
