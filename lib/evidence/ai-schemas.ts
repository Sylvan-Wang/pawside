/**
 * Pawside — AI output schemas (AI Patch §25, §26, §27, §31).
 *
 * Four surfaces, each with its own contract:
 *   Workout Session Feedback — §25.2
 *   Meal Feedback            — §26
 *   Daily Review             — §27.1
 *   Weekly Review            — §29 / Product §24
 *
 * Design rules encoded here:
 *   §25.3 / §26 / §31 — every observation carries `signal_key` and
 *     `evidence_ref_ids`, and every next action carries a `basis`. That is what
 *     makes numeric integrity checkable: a claim with no signal behind it is
 *     rejectable rather than merely discouraged.
 *   §28 — the Daily Review is capped at 2–3 key findings; the schema enforces it.
 *   §30 / AC-AI12 — the model never emits a source URL. Citations are resolved
 *     from the Evidence Registry by `evidence_ref_ids`.
 *   Product §10 / §27 — an empty explanation is a valid output. Nothing may be
 *     invented to fill a slot.
 */

/** Shared enums, mirrored from lib/nutrition/interpretation.ts. */
const statusEnum = [
  'within_reference',
  'below_reference',
  'above_reference',
  'caution',
  'warning',
  'insufficient_data',
  'not_assessable',
] as const

const domainEnum = [
  'health_guideline',
  'training_optimization',
  'user_target',
  'data_quality',
  'subjective_recovery',
  'safety_signal',
] as const

const basisEnum = ['method', 'rule', 'evidence'] as const

export const MATERIALISED_AT = 'ai_schemas_v1'

/** AI Patch §25.2 — Workout Session Feedback. */
export const workoutSessionFeedbackSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', maxLength: 60 },
    observations: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 120 },
          // §25.3 rule 1: the model may only reference supplied signals.
          signal_key: { type: 'string' },
          status: { type: 'string', enum: statusEnum },
          domain: { type: 'string', enum: domainEnum },
          evidence_ref_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'signal_key', 'status', 'domain', 'evidence_ref_ids'],
      },
    },
    // §25.3 rule 4: at most 2 next actions.
    next_actions: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 120 },
          basis: { type: 'string', enum: basisEnum },
        },
        required: ['text', 'basis'],
      },
    },
    // §25.3 rule 3: a data-quality anomaly is not a health risk.
    data_quality_tip: { type: ['string', 'null'] },
  },
  required: ['summary', 'observations', 'next_actions', 'data_quality_tip'],
} as const

/** AI Patch §26 — Meal Feedback. */
export const mealFeedbackSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', maxLength: 60 },
    observations: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 120 },
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
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 120 },
          basis: { type: 'string', enum: basisEnum },
        },
        required: ['text', 'basis'],
      },
    },
    safety_note: { type: ['string', 'null'] },
  },
  required: ['summary', 'observations', 'next_actions', 'safety_note'],
} as const

/** AI Patch §27.1 — Daily Review, with the §28 priority and cap. */
export const dailyReviewSchemaV2 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overall: { type: 'string', maxLength: 80 },
    // §28: "最多 2–3 key findings", and the priority order is fixed.
    key_findings: {
      type: 'array',
      minItems: 0,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 120 },
          domain: { type: 'string', enum: ['training', 'nutrition', 'body', 'recovery'] },
          evidence_ref_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'domain', 'evidence_ref_ids'],
      },
    },
    tomorrow_guidance: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 120 },
          basis: { type: 'string', enum: basisEnum },
        },
        required: ['text', 'basis'],
      },
    },
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
    data_quality_tip: { type: ['string', 'null'] },
  },
  required: ['overall', 'key_findings', 'tomorrow_guidance', 'safety', 'data_quality_tip'],
} as const

/**
 * Product §24 — Weekly Review slots. AI Patch §29 forbids this from being a
 * concatenation of seven daily reviews, so the schema has no per-day field.
 */
export const weeklyReviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    what_happened: { type: 'string', maxLength: 240 },
    clearest_trend: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', maxLength: 160 },
        // Must name a trend the Trend Engine produced.
        metric_key: { type: 'string' },
        direction: {
          type: 'string',
          enum: ['increasing', 'decreasing', 'stable', 'volatile', 'insufficient'],
        },
        evidence_ref_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['text', 'metric_key', 'direction', 'evidence_ref_ids'],
    },
    worth_noting: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 160 },
          domain: { type: 'string', enum: ['training', 'nutrition', 'body', 'recovery'] },
          evidence_ref_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'domain', 'evidence_ref_ids'],
      },
    },
    next_week: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 160 },
          basis: { type: 'string', enum: basisEnum },
        },
        required: ['text', 'basis'],
      },
    },
  },
  required: ['what_happened', 'clearest_trend', 'worth_noting', 'next_week'],
} as const

// ─── Prompt rules shared by all four surfaces ────────────────────────────────

/**
 * AI Patch §25.3 / §6 / §31, expressed as instructions. These are belt-and-
 * braces: the real enforcement is `validateNumericIntegrity` plus the schema's
 * `evidence_ref_ids` requirement, because a prompt cannot guarantee anything.
 */
export const AI_NUMERIC_INTEGRITY_RULES = `Rules you must follow:
- Use ONLY the numbers present in the supplied facts. Never compute, estimate, or round a new number.
- Never invent a nutrition value, a calorie total, a macro remainder, a food weight in grams, or a training volume.
- Every observation must reference a signal_key that exists in the supplied signals.
- Never state a source, study, organisation, or year. Evidence is resolved from evidence_ref_ids on our side.
- A data-quality anomaly is a recording issue, not a health finding. Never describe it as over-training, unhealthy, or a medical risk.
- Do not diagnose disease, prescribe medication, or replace professional medical care.
- If the facts are insufficient for a point, omit the point rather than filling the gap.
- Subjective recovery values are context only. Never announce that the user cannot train today.
- All user-facing text must be Chinese.`

export interface AiSchemaBundle {
  name: string
  schema: object
  maxOutputTokens: number
  promptVersion: string
}

/** Version strings are persisted with generated content (AI Patch §32.1). */
export const AI_PROMPT_VERSIONS = {
  workout_session_feedback: 'openai_workout_session_feedback_v1',
  meal_feedback: 'openai_meal_feedback_v1',
  daily_review: 'openai_daily_review_v3',
  weekly_review: 'openai_weekly_review_v1',
} as const

/**
 * Keys are the wire surface names, deliberately identical to
 * `ai_feedback.content_type` (20260926000300_recovery_feedback_targets.sql) and
 * to the Product §14 rating scopes, so one string identifies a surface
 * everywhere it appears.
 */
export const AI_SCHEMAS = {
  workout_session_feedback: {
    name: 'pawside_workout_session_feedback',
    schema: workoutSessionFeedbackSchema,
    maxOutputTokens: 600,
    promptVersion: AI_PROMPT_VERSIONS.workout_session_feedback,
  },
  meal_feedback: {
    name: 'pawside_meal_feedback',
    schema: mealFeedbackSchema,
    maxOutputTokens: 600,
    promptVersion: AI_PROMPT_VERSIONS.meal_feedback,
  },
  daily_review: {
    name: 'pawside_daily_review',
    schema: dailyReviewSchemaV2,
    maxOutputTokens: 700,
    promptVersion: AI_PROMPT_VERSIONS.daily_review,
  },
  weekly_review: {
    name: 'pawside_weekly_review',
    schema: weeklyReviewSchema,
    maxOutputTokens: 900,
    promptVersion: AI_PROMPT_VERSIONS.weekly_review,
  },
} as const satisfies Record<string, AiSchemaBundle>

export type AiSurface = keyof typeof AI_SCHEMAS
