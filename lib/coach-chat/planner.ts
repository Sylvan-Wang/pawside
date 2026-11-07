import { callStructuredOutput, getChatModel, type OpenAIFailureReason, type OpenAIUsage } from '../ai-client'
import { estimateFoodsPer100g } from '../nutrition/food-resolver'
import type { FoodEstimator } from './meal'
import { isRawPlan, PLAN_JSON_SCHEMA, PLAN_SCHEMA_NAME, type RawPlan } from './schemas'

/**
 * The two model calls a chat turn can make, each behind a function type so the
 * orchestrator can be tested with scripted outputs and the real calls swapped
 * in at the route:
 *   1. planner   - understand the sentence into a plan (always)
 *   2. estimator - per-100g guesses for foods the database does not know (only when needed)
 * Budget per turn: at most these two calls (Patch §4).
 */

export type PlannerResult =
  | { ok: true; plan: RawPlan; model: string; latencyMs: number; usage?: OpenAIUsage }
  | { ok: false; reason: OpenAIFailureReason; model: string; latencyMs: number; detail?: string }

export type Planner = (system: string, input: string) => Promise<PlannerResult>

const PLANNER_TIMEOUT_MS = 15_000
const PLANNER_MAX_OUTPUT_TOKENS = 1200

/** Retry once only when a second try can plausibly help and still fits the request's time budget. */
const RETRY_IF_FIRST_UNDER_MS = 6_000
const NOT_RETRYABLE_STATUS = new Set([400, 401, 403, 404])

export function createPlanner(): Planner {
  return async (system, input) => {
    const startedAt = Date.now()
    const call = () => callStructuredOutput<RawPlan>(
      system,
      input,
      PLAN_SCHEMA_NAME,
      PLAN_JSON_SCHEMA,
      isRawPlan,
      PLANNER_MAX_OUTPUT_TOKENS,
      { model: getChatModel(), timeoutMs: PLANNER_TIMEOUT_MS },
    )
    let result = await call()
    let attempts = 1
    if (
      !result.ok
      && (result.reason === 'upstream_error' || result.reason === 'invalid_response')
      && !(result.httpStatus !== undefined && NOT_RETRYABLE_STATUS.has(result.httpStatus))
      && Date.now() - startedAt < RETRY_IF_FIRST_UNDER_MS
    ) {
      result = await call()
      attempts = 2
    }
    const latencyMs = Date.now() - startedAt
    if (!result.ok) {
      const detail = [result.httpStatus ? `http_${result.httpStatus}` : null, `attempts_${attempts}`].filter(Boolean).join(' ')
      return { ok: false, reason: result.reason, model: result.model, latencyMs, detail }
    }
    return { ok: true, plan: result.data, model: result.model, latencyMs, usage: result.usage }
  }
}

export function createEstimator(): FoodEstimator {
  return async (names) => {
    const result = await estimateFoodsPer100g(names, { model: getChatModel(), timeoutMs: 15_000 })
    return result.ok ? { ok: true, byName: result.byName } : { ok: false, reason: result.reason }
  }
}
