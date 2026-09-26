import { describe, expect, it } from 'vitest'
import {
  buildMealFeedbackExplanation,
  computeMealFeedbackStatus,
} from '../../lib/nutrition/meal-feedback.ts'
import type { DailyNutritionFacts } from '../../lib/nutrition/persistence.ts'

/**
 * Phase B verification — Meal Feedback status layer (Product §10.1, AC-P04).
 *
 * Uses the real derived macro targets for 1800 kcal / 70 kg
 * (protein 112g, carb 225.5g, fat 50g — see tests/nutrition/macro-targets).
 */
function facts(overrides: Partial<DailyNutritionFacts> = {}): DailyNutritionFacts {
  return {
    target: { calories_kcal: 1800, protein_g: 112, carbs_g: 225.5, fat_g: 50 },
    consumed: { calories_kcal: 900, protein_g: 60, carbs_g: 100, fat_g: 25 },
    remaining: { calories_kcal: 900, protein_g: 52, carbs_g: 125.5, fat_g: 25 },
    meal_count: 2,
    data_completeness: 'complete',
    ...overrides,
  }
}

describe('computeMealFeedbackStatus — no target (Product §27)', () => {
  it('reports not_assessable instead of fabricating a comparison', () => {
    const statuses = computeMealFeedbackStatus(facts({
      target: { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null },
      remaining: null,
    }))

    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe('not_assessable')
    // The user must be told to set a target rather than shown a fake one.
    expect(statuses[0].explanation).toContain('没有设置')
    expect(statuses[0].authority).toBe('Product Patch §27')
  })

  it('does not emit a below_reference reading without a target', () => {
    const statuses = computeMealFeedbackStatus(facts({
      target: { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null },
      consumed: { calories_kcal: 200, protein_g: 5, carbs_g: 20, fat_g: 3 },
      remaining: null,
      data_completeness: 'complete',
    }))

    expect(statuses.some((status) => status.status === 'below_reference')).toBe(false)
  })
})

describe('computeMealFeedbackStatus — completeness (AC-P04)', () => {
  it('downgrades a low reading to insufficient_data when the log is partial', () => {
    // 200/1800 is far below the band, but the log is incomplete, so the app
    // must NOT tell the user they ate too little.
    const statuses = computeMealFeedbackStatus(facts({
      consumed: { calories_kcal: 200, protein_g: 5, carbs_g: 20, fat_g: 3 },
      data_completeness: 'partial',
    }), { isCompleteDay: false })

    expect(statuses[0].status).toBe('insufficient_data')
    expect(statuses[0].domain).toBe('data_quality')
    // The caveat must be present so the user knows the judgement is provisional.
    expect(statuses[0].explanation).toContain('未记录')
  })

  it('reports below_reference only when the log is complete', () => {
    const statuses = computeMealFeedbackStatus(facts({
      consumed: { calories_kcal: 200, protein_g: 5, carbs_g: 20, fat_g: 3 },
      data_completeness: 'complete',
    }))

    expect(statuses[0].status).toBe('below_reference')
    // Wording is against the user's OWN target, never a safety floor.
    expect(statuses[0].explanation).toContain('你设置的热量目标')
    expect(statuses[0].explanation).not.toContain('危险')
  })
})

describe('computeMealFeedbackStatus — exact user target comparison', () => {
  it('reports within_reference at the exact target', () => {
    const statuses = computeMealFeedbackStatus(facts({
      consumed: { calories_kcal: 1800, protein_g: 112, carbs_g: 225.5, fat_g: 50 },
    }))
    expect(statuses[0].status).toBe('within_reference')
  })

  it('reports above_reference over target without calling it unhealthy', () => {
    const statuses = computeMealFeedbackStatus(facts({
      consumed: { calories_kcal: 2400, protein_g: 150, carbs_g: 300, fat_g: 70 },
    }))

    expect(statuses[0].status).toBe('above_reference')
    expect(statuses[0].domain).toBe('user_target')
    for (const word of ['不健康', '危险', '风险']) {
      expect(statuses[0].explanation).not.toContain(word)
    }
  })

  it('does not call an in-progress day below target', () => {
    const statuses = computeMealFeedbackStatus(facts({
      consumed: { calories_kcal: 1440, protein_g: 112, carbs_g: 225.5, fat_g: 50 },
    }), { isCompleteDay: false })
    expect(statuses[0].status).toBe('insufficient_data')
  })

  it('never classifies a comparison against a user target as a health guideline', () => {
    // AI Patch §24: this judgement domain must be user_target.
    for (const kcal of [200, 1800, 2400]) {
      const statuses = computeMealFeedbackStatus(facts({
        consumed: { calories_kcal: kcal, protein_g: 50, carbs_g: 100, fat_g: 30 },
      }))
      expect(statuses[0].domain).not.toBe('health_guideline')
    }
  })
})

describe('meal feedback explanation container (Product §10)', () => {
  it('stays empty until the AI Composer exists', () => {
    // Product §10: the UI must not ship pre-written "AI" answers.
    expect(buildMealFeedbackExplanation()).toBeNull()
  })
})
