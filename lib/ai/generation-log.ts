/**
 * Pawside Coach — generation log (spec A0-3).
 *
 * Writes one row to public.ai_generations per model call, success AND
 * failure. Today the only persisted AI output is `ai_generated_content`, and
 * it is written ONLY when composeWithEvidence returns ok; a failure
 * (not_configured, timeout, forbidden_claim, ...) leaves no trace at all. This
 * table exists so "did the AI even run, and why did it fail" is answerable.
 *
 * Contract:
 *  - NEVER throws. Logging must not be able to break the facts layer or the
 *    user-facing response (same rule composeWithEvidence's own failures follow).
 *  - Called from exactly one place: composeWithEvidence, once per attempt.
 *    Surfaces do not call it directly.
 *  - Stores the full payload so a generation can be replayed for eval later
 *    (spec MUST 7: no eval infrastructure this period, but the trace should
 *    not have to be rebuilt once the user base grows).
 */

import { createClient } from '../supabase/server'
import type { AiSurface } from '../evidence/ai-schemas'
import type { OpenAIFailureReason } from '../ai-client'
import type { CheckFailure } from '../evidence/output-checks'

/** Surfaces the log accepts. Includes two not yet wired to composeWithEvidence,
 * reserved so their tables/rows exist before the callers do. */
export type AISurface = AiSurface | 'advisory_plan' | 'coach_chat' | 'method_import'

/**
 * Every reason composeWithEvidence can fail for. Defined here (not in
 * composer.ts) so `ComposeFailure['reason']` and the DB check constraint stay
 * a single source of truth instead of two lists that can drift apart.
 */
export type AIFailReason =
  | OpenAIFailureReason
  | 'unbound_evidence'
  | 'internal_term'
  | CheckFailure['code']

export type InvokedBy = 'ui' | 'orchestrator' | 'schedule' | 'eval'

/**
 * Tracing context, reserved for the future Coach Chat orchestrator (spec
 * §10). A surface called from a page passes nothing and gets
 * invoked_by='ui'. Not wired to anything yet in this period.
 */
export interface TraceContext {
  traceId?: string
  parentGenerationId?: string
  invokedBy?: InvokedBy
  turnIndex?: number
}

export interface GenerationRecord {
  userId: string
  surface: AISurface
  scopeId?: string | null
  inputSnapshotId: string
  promptVersion: string
  model: string
  evidenceRegistryVersion?: string | null
  payload: unknown
  output?: unknown | null
  status: 'ok' | 'failed'
  failReason?: AIFailReason | null
  failDetail?: string | null
  attempt?: number
  latencyMs?: number | null
  tokensIn?: number | null
  tokensOut?: number | null
  trace?: TraceContext
}

const MAX_DETAIL_CHARS = 2000

/** Returns the new row id, or null if logging failed. Never throws. */
export async function logGeneration(record: GenerationRecord): Promise<string | null> {
  try {
    // ok <=> no fail_reason (DB constraint); keep failed-looking leftovers off
    // a row we are about to mark ok.
    const failReason = record.status === 'ok' ? null : record.failReason ?? null
    const failDetail = record.status === 'ok'
      ? null
      : record.failDetail
        ? record.failDetail.slice(0, MAX_DETAIL_CHARS)
        : null

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('ai_generations')
      .insert({
        user_id: record.userId,
        surface: record.surface,
        scope_id: record.scopeId ?? null,
        input_snapshot_id: record.inputSnapshotId,
        prompt_version: record.promptVersion,
        model: record.model,
        evidence_registry_version: record.evidenceRegistryVersion ?? null,
        payload: record.payload,
        output: record.output ?? null,
        status: record.status,
        fail_reason: failReason,
        fail_detail: failDetail,
        attempt: record.attempt ?? 1,
        latency_ms: record.latencyMs ?? null,
        tokens_in: record.tokensIn ?? null,
        tokens_out: record.tokensOut ?? null,
        trace_id: record.trace?.traceId ?? null,
        parent_generation_id: record.trace?.parentGenerationId ?? null,
        invoked_by: record.trace?.invokedBy ?? 'ui',
        turn_index: record.trace?.turnIndex ?? null,
      })
      .select('id')
      .single()

    if (error) {
      console.warn('[ai_generations] insert failed', error.code, error.message)
      return null
    }
    return (data?.id as string | undefined) ?? null
  } catch (err) {
    console.warn('[ai_generations] logging threw', err instanceof Error ? err.message : err)
    return null
  }
}
