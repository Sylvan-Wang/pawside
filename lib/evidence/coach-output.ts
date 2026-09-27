/**
 * Pawside Coach — the unified output structure `coach_output_v1` (spec A0-4)
 * and the three-state display contract it feeds (spec A0-5).
 *
 * `docs/coach/HANDOFF.md` §3 notes that `lib/evidence/coach-output.ts` does not
 * exist on any branch and must be built from the spec directly — this is that
 * file.
 *
 * Scope note (T4): only the three surfaces that already carry real content
 * (workout_session_feedback, meal_feedback, daily_review) are wired to this
 * structure here. weekly_review's real restructuring (`patterns`,
 * `last_week_review`, `body_change`) is B6/A4-linked substantive work assigned
 * to T9, not infrastructure — wrapping its current placeholder content in this
 * schema now would just have to be redone. See the T4 PR description.
 */

import { statusEnum, domainEnum, basisEnum, type AiSurface } from './ai-schemas'
import type { InterpretedSignal } from '../nutrition/interpretation'

/** D10 — the first five action types the action row can offer. */
export const ACTION_TYPES = [
  'log_meal',
  'complete_record',
  'view_next_session',
  'add_recovery_checkin',
  'none',
] as const

export type CoachActionType = (typeof ACTION_TYPES)[number]

export interface CoachOutputV1 {
  headline: string
  primary_focus: { signal_keys: string[]; why_now: string }
  evidence: Array<{
    text: string
    signal_key: string
    status: (typeof statusEnum)[number]
    /** Not in the spec's field table verbatim, but required to map evidence[]
     * back to the legacy observations[]/key_findings[] domain field without
     * the composer guessing at it. */
    domain: (typeof domainEnum)[number]
    evidence_ref_ids: string[]
  }>
  next_actions: Array<{
    text: string
    action_type: CoachActionType
    basis: (typeof basisEnum)[number]
  }>
  data_quality_tip: string | null
  safety: { level: 'none' | 'caution' | 'warning'; text: string | null; evidence_ref_ids: string[] }
}

export type CoachOutputSurface = Extract<AiSurface, 'workout_session_feedback' | 'meal_feedback' | 'daily_review'>

/** Per-node caps from spec A0-4's "各节点上限" table. */
const CAPS: Record<CoachOutputSurface, { evidence: number; actions: number }> = {
  workout_session_feedback: { evidence: 2, actions: 2 },
  meal_feedback: { evidence: 1, actions: 1 },
  daily_review: { evidence: 2, actions: 2 },
}

/** Builds the strict JSON schema for `coach_output_v1`, capped per surface. */
export function buildCoachOutputSchema(surface: CoachOutputSurface): object {
  const caps = CAPS[surface]
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string', maxLength: 40 },
      primary_focus: {
        type: 'object',
        additionalProperties: false,
        properties: {
          signal_keys: { type: 'array', items: { type: 'string' } },
          why_now: { type: 'string', maxLength: 60 },
        },
        required: ['signal_keys', 'why_now'],
      },
      evidence: {
        type: 'array',
        maxItems: caps.evidence,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', maxLength: 60 },
            signal_key: { type: 'string' },
            status: { type: 'string', enum: statusEnum },
            domain: { type: 'string', enum: domainEnum },
            evidence_ref_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['text', 'signal_key', 'status', 'domain', 'evidence_ref_ids'],
        },
      },
      next_actions: {
        type: 'array',
        maxItems: caps.actions,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', maxLength: 40 },
            action_type: { type: 'string', enum: ACTION_TYPES },
            basis: { type: 'string', enum: basisEnum },
          },
          required: ['text', 'action_type', 'basis'],
        },
      },
      data_quality_tip: { type: ['string', 'null'] },
      safety: {
        type: 'object',
        additionalProperties: false,
        properties: {
          level: { type: 'string', enum: ['none', 'caution', 'warning'] },
          text: { type: ['string', 'null'] },
          evidence_ref_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['level', 'text', 'evidence_ref_ids'],
      },
    },
    required: ['headline', 'primary_focus', 'evidence', 'next_actions', 'data_quality_tip', 'safety'],
  }
}

export const COACH_OUTPUT_PROMPT_VERSIONS: Record<CoachOutputSurface, string> = {
  workout_session_feedback: 'openai_workout_session_feedback_v2',
  meal_feedback: 'openai_meal_feedback_v2',
  daily_review: 'openai_daily_review_v4',
}

/**
 * Maps `coach_output_v1` back to the legacy per-surface field names so
 * existing consumers (History, the training/food pages) keep working
 * unchanged (spec A0-4 "兼容": `compatibleReview()`). Callers needing the full
 * structure (a future CoachCard) should read the raw `coach_output_v1`
 * instead of this.
 */
export function compatibleReview(output: CoachOutputV1, surface: CoachOutputSurface): unknown {
  const observations = output.evidence.map((item) => ({
    text: item.text,
    signal_key: item.signal_key,
    status: item.status,
    domain: item.domain,
    evidence_ref_ids: item.evidence_ref_ids,
  }))
  const actions = output.next_actions.map((action) => ({ text: action.text, basis: action.basis }))

  if (surface === 'daily_review') {
    return {
      overall: output.headline,
      key_findings: observations.map(({ text, domain, evidence_ref_ids }) => ({ text, domain, evidence_ref_ids })),
      tomorrow_guidance: actions,
      safety: output.safety,
      data_quality_tip: output.data_quality_tip,
    }
  }

  return {
    summary: output.headline,
    observations,
    next_actions: actions,
    data_quality_tip: output.data_quality_tip,
    ...(surface === 'meal_feedback' ? { safety_note: output.safety.text } : {}),
  }
}

/**
 * Rough priority ranking for spec D7 ("安全 > 坚持 > 训练执行 > 热量 > 蛋白 >
 * 细节"), expressed at the domain granularity phase A has (the full B2
 * ranking is a later phase). Returns signal metric_keys, most important first.
 */
const DOMAIN_RANK: Record<string, number> = {
  safety_signal: 0,
  training_optimization: 1,
  health_guideline: 2,
  user_target: 3,
  subjective_recovery: 4,
  data_quality: 5,
}

export function rankSignalsForContext(signals: Pick<InterpretedSignal, 'metric_key' | 'domain'>[]): string[] {
  return [...signals]
    .sort((a, b) => (DOMAIN_RANK[a.domain] ?? 99) - (DOMAIN_RANK[b.domain] ?? 99))
    .map((signal) => signal.metric_key)
}

/**
 * Deterministic `allowed_actions` per surface (spec A0-4 context field):
 * "没有缺失记录时，就不给 complete_record" is the model, this is the rule.
 * `none` is always offered so a real generation is never forced to name an
 * action that does not apply.
 */
export function computeAllowedActions(input: {
  surface: CoachOutputSurface
  hasIncompleteRecord?: boolean
  hasNextSession?: boolean
  hasRecoveryCheckinToday?: boolean
}): CoachActionType[] {
  const actions: CoachActionType[] = []
  if (input.surface === 'meal_feedback') actions.push('log_meal')
  if (input.hasIncompleteRecord) actions.push('complete_record')
  if (input.hasNextSession) actions.push('view_next_session')
  if (input.surface === 'daily_review' && input.hasRecoveryCheckinToday === false) actions.push('add_recovery_checkin')
  actions.push('none')
  return actions
}
