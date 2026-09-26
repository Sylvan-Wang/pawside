import type { InterpretedStatus, JudgementDomain } from '../nutrition/interpretation'
import type { DailyNutritionFacts } from './persistence'

/**
 * Pawside — Meal Feedback status layer (Product §10.1 layer 2).
 *
 * ORDER OF CONCERN (Product §10.1): Facts → Status → Explanation.
 * This module produces Status only; Facts come straight from the deterministic
 * budget, and Explanation is the AI Composer's job (later phase).
 *
 * AI Patch §14 / E-NUT-SAFE-001: there is NO universal calorie floor, so
 * "below" here means "below YOUR OWN target", never "below a safe amount".
 * The wording must therefore say 参考 (reference), never 危险 (dangerous).
 *
 * COMPLETENESS RULE (AC-P04)
 * --------------------------
 * A low reading from an incomplete log must NOT be presented as real low
 * intake. When `data_completeness !== 'complete'`, a below-reference result is
 * downgraded to `insufficient_data` and carries the completeness caveat.
 */

export interface MealFeedbackStatus {
  metric_key: string
  status: InterpretedStatus
  /**
   * AI Patch §24: a comparison against the user's OWN target is a `user_target`
   * judgement. It is never `health_guideline`, because Pawside has no universal
   * calorie guideline to apply (AI Patch §14).
   */
  domain: JudgementDomain
  explanation: string
  evidence_ref_ids: string[]
  /** Stable key for the Evidence `?` surface (Product §25 / AC-P14). */
  authority: string
}

export function computeMealFeedbackStatus(
  facts: DailyNutritionFacts,
  options: { isCompleteDay?: boolean } = {},
): MealFeedbackStatus[] {
  const statuses: MealFeedbackStatus[] = []
  const hasTarget = facts.target.calories_kcal !== null
  const complete = facts.data_completeness === 'complete' && options.isCompleteDay !== false

  // No target at all: Product §27 says show consumed and offer to set a target,
  // never fabricate one. There is nothing to compare against, so the metric is
  // explicitly not assessable rather than "within reference".
  if (!hasTarget) {
    statuses.push({
      metric_key: 'nutrition.calories',
      status: 'not_assessable',
      domain: 'user_target',
      explanation: '还没有设置每日热量目标，暂时只展示已记录摄入。',
      evidence_ref_ids: [],
      authority: 'Product Patch §27',
    })
    return statuses
  }

  const target = facts.target.calories_kcal as number
  const consumed = facts.consumed.calories_kcal
  if (consumed === null) {
    statuses.push({
      metric_key: 'nutrition.calories',
      status: 'insufficient_data',
      domain: 'data_quality',
      explanation: '当前饮食记录缺少热量资料，无法与目标比较。',
      evidence_ref_ids: [],
      authority: 'Guardrail §12',
    })
    return statuses
  }
  if (target <= 0) {
    statuses.push({
      metric_key: 'nutrition.calories',
      status: 'not_assessable',
      domain: 'user_target',
      explanation: '当前热量目标无效，无法比较。',
      evidence_ref_ids: [],
      authority: 'Product Patch §27',
    })
    return statuses
  }

  if (!complete && consumed < target) {
    // AC-P04: a day still in progress is not a completed low-intake day.
    statuses.push({
      metric_key: 'nutrition.calories',
      status: 'insufficient_data',
      domain: 'data_quality',
      explanation: '截至目前已记录摄入尚未达到你的目标；当天仍未结束，也可能还有未记录饮食，因此不作全天不足判断。',
      evidence_ref_ids: [],
      authority: 'Product Patch §5.2 / AC-P04',
    })
    return statuses
  }

  if (consumed > target) {
    statuses.push({
      metric_key: 'nutrition.calories',
      status: 'above_reference',
      domain: 'user_target',
      explanation: '今日已记录摄入高于你设置的热量目标。',
      evidence_ref_ids: [],
      authority: 'Product Patch §4.2',
    })
    return statuses
  }

  if (complete && consumed < target) {
    statuses.push({
      metric_key: 'nutrition.calories',
      status: 'below_reference',
      domain: 'user_target',
      explanation: '根据完整记录，今日摄入低于你设置的热量目标。',
      evidence_ref_ids: [],
      authority: 'Product Patch §5.2',
    })
    return statuses
  }

  statuses.push({
    metric_key: 'nutrition.calories',
    status: 'within_reference',
    domain: 'user_target',
    explanation: '今日已记录摄入等于你设置的热量目标。',
    evidence_ref_ids: [],
    authority: 'Product Patch §4.2',
  })
  return statuses
}

/**
 * Product §10.1: the explanation region may be empty. Until the AI Composer
 * exists, this returns null rather than a hand-written sentence pretending to
 * be AI output (Product §10: "UI 不提前写 AI 答案").
 */
export function buildMealFeedbackExplanation(): null {
  return null
}
