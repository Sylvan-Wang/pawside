import { describe, expect, it } from 'vitest'
import {
  buildCoachOutputSchema,
  compatibleReview,
  computeAllowedActions,
  rankSignalsForContext,
  type CoachOutputV1,
} from '../../lib/evidence/coach-output.ts'

function sample(overrides: Partial<CoachOutputV1> = {}): CoachOutputV1 {
  return {
    headline: '卧推三组都按计划完成',
    primary_focus: { signal_keys: ['training.session_duration'], why_now: 'test' },
    evidence: [
      {
        text: '末组做到了 10 + 5 次',
        signal_key: 'training.session_duration',
        status: 'within_reference',
        domain: 'training_optimization',
        evidence_ref_ids: [],
      },
    ],
    next_actions: [{ text: '下次拉训练关注划船末组', action_type: 'view_next_session', basis: 'method' }],
    data_quality_tip: null,
    safety: { level: 'none', text: null, evidence_ref_ids: [] },
    ...overrides,
  }
}

describe('buildCoachOutputSchema', () => {
  it('caps evidence and next_actions per the A0-4 field table', () => {
    const workout = buildCoachOutputSchema('workout_session_feedback') as { properties: { evidence: { maxItems: number }; next_actions: { maxItems: number } } }
    expect(workout.properties.evidence.maxItems).toBe(2)
    expect(workout.properties.next_actions.maxItems).toBe(2)

    const meal = buildCoachOutputSchema('meal_feedback') as { properties: { evidence: { maxItems: number }; next_actions: { maxItems: number } } }
    expect(meal.properties.evidence.maxItems).toBe(1)
    expect(meal.properties.next_actions.maxItems).toBe(1)
  })

  it('is a strict schema (no additional properties anywhere)', () => {
    const schema = buildCoachOutputSchema('daily_review') as { additionalProperties: boolean; properties: Record<string, { additionalProperties?: boolean; items?: { additionalProperties?: boolean } }> }
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.primary_focus.additionalProperties).toBe(false)
    expect(schema.properties.evidence.items?.additionalProperties).toBe(false)
    expect(schema.properties.next_actions.items?.additionalProperties).toBe(false)
    expect(schema.properties.safety.additionalProperties).toBe(false)
  })
})

describe('compatibleReview', () => {
  it('maps to the legacy workout/meal shape (summary/observations/next_actions)', () => {
    const legacy = compatibleReview(sample(), 'workout_session_feedback') as {
      summary: string; observations: unknown[]; next_actions: unknown[]; data_quality_tip: string | null
    }
    expect(legacy.summary).toBe('卧推三组都按计划完成')
    expect(legacy.observations).toHaveLength(1)
    expect(legacy.next_actions).toEqual([{ text: '下次拉训练关注划船末组', basis: 'method' }])
    expect(legacy.data_quality_tip).toBeNull()
  })

  it('adds safety_note only for meal_feedback', () => {
    const withSafety = sample({ safety: { level: 'caution', text: '低于你设置的参考', evidence_ref_ids: [] } })
    const meal = compatibleReview(withSafety, 'meal_feedback') as { safety_note?: string | null }
    expect(meal.safety_note).toBe('低于你设置的参考')

    const workout = compatibleReview(withSafety, 'workout_session_feedback') as { safety_note?: string }
    expect(workout.safety_note).toBeUndefined()
  })

  it('maps to the legacy daily_review shape (overall/key_findings/tomorrow_guidance)', () => {
    const legacy = compatibleReview(sample(), 'daily_review') as {
      overall: string; key_findings: Array<{ text: string; domain: string; evidence_ref_ids: string[] }>
      tomorrow_guidance: unknown[]; safety: unknown
    }
    expect(legacy.overall).toBe('卧推三组都按计划完成')
    expect(legacy.key_findings).toEqual([
      { text: '末组做到了 10 + 5 次', domain: 'training_optimization', evidence_ref_ids: [] },
    ])
    expect(legacy.tomorrow_guidance).toEqual([{ text: '下次拉训练关注划船末组', basis: 'method' }])
    expect(legacy.safety).toEqual(sample().safety)
  })
})

describe('rankSignalsForContext', () => {
  it('orders safety before training before nutrition before data quality (spec D7)', () => {
    const ranked = rankSignalsForContext([
      { metric_key: 'training.duration', domain: 'data_quality' },
      { metric_key: 'nutrition.protein', domain: 'user_target' },
      { metric_key: 'recovery.self_report', domain: 'safety_signal' },
      { metric_key: 'training.volume', domain: 'training_optimization' },
    ])
    expect(ranked).toEqual(['recovery.self_report', 'training.volume', 'nutrition.protein', 'training.duration'])
  })
})

describe('computeAllowedActions', () => {
  it('always offers none, and log_meal only for meal_feedback', () => {
    expect(computeAllowedActions({ surface: 'meal_feedback' })).toEqual(['log_meal', 'none'])
    expect(computeAllowedActions({ surface: 'workout_session_feedback' })).toEqual(['none'])
  })

  it('offers complete_record only when something is missing', () => {
    expect(computeAllowedActions({ surface: 'workout_session_feedback', hasIncompleteRecord: true }))
      .toEqual(['complete_record', 'none'])
    expect(computeAllowedActions({ surface: 'workout_session_feedback', hasIncompleteRecord: false }))
      .toEqual(['none'])
  })

  it('offers add_recovery_checkin only for daily_review without a checkin today', () => {
    expect(computeAllowedActions({ surface: 'daily_review', hasRecoveryCheckinToday: false }))
      .toContain('add_recovery_checkin')
    expect(computeAllowedActions({ surface: 'daily_review', hasRecoveryCheckinToday: true }))
      .not.toContain('add_recovery_checkin')
    expect(computeAllowedActions({ surface: 'workout_session_feedback', hasRecoveryCheckinToday: false }))
      .not.toContain('add_recovery_checkin')
  })
})
