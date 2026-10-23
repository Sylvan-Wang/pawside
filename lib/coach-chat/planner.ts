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
  | { ok: false; reason: OpenAIFailureReason; model: string; latencyMs: number }

export type Planner = (system: string, input: string) => Promise<PlannerResult>

const PLANNER_TIMEOUT_MS = 15_000
const PLANNER_MAX_OUTPUT_TOKENS = 1200

export function createPlanner(): Planner {
  return async (system, input) => {
    const startedAt = Date.now()
    const result = await callStructuredOutput<RawPlan>(
      system,
      input,
      PLAN_SCHEMA_NAME,
      PLAN_JSON_SCHEMA,
      isRawPlan,
      PLANNER_MAX_OUTPUT_TOKENS,
      { model: getChatModel(), timeoutMs: PLANNER_TIMEOUT_MS },
    )
    const latencyMs = Date.now() - startedAt
    if (!result.ok) return { ok: false, reason: result.reason, model: result.model, latencyMs }
    return { ok: true, plan: result.data, model: result.model, latencyMs, usage: result.usage }
  }
}

export function createEstimator(): FoodEstimator {
  return async (names) => {
    const result = await estimateFoodsPer100g(names, { model: getChatModel(), timeoutMs: 15_000 })
    return result.ok ? { ok: true, byName: result.byName } : { ok: false, reason: result.reason }
  }
}
