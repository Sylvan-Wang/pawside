import {
  callStructuredOutput,
  getOpenAIConfigStatus,
  type OpenAIFailureReason,
  type OpenAIResult,
} from '../ai-client'
import { EVIDENCE_REGISTRY_VERSION, buildOutputCheckRegistry, getEvidenceItem } from './registry'
import {
  AI_SCHEMAS,
  AI_NUMERIC_INTEGRITY_RULES,
  type AiSurface,
} from './ai-schemas'
import type { InterpretedSignal, MetricFact } from '../nutrition/interpretation'
import { findInternalTerms } from '../coach/display'
import { COACH_SHARED_RULES } from '../coach/prompts'
import {
  collectUserFacingStrings,
  runOutputChecks,
  retryHint,
  type CheckFailure,
} from './output-checks'

/**
 * Pawside — AI Composer (AI Patch §1, §6, §25.3, §31).
 *
 * The composer is the ONLY place an LLM is asked to produce user-facing review
 * text. It receives:
 *   - deterministic MetricFacts (numbers it may repeat, never compute)
 *   - InterpretedSignals (judgements it may explain, never make)
 *   - Evidence refs (resolved to citations on our side; §30)
 *
 * It is never given raw logs, and it is never asked "is this reasonable?".
 */

export type ComposerSurface = AiSurface

export interface ComposeInput {
  surface: ComposerSurface
  /** Deterministic facts. Nothing outside this set may appear as a number. */
  facts: MetricFact[]
  /** Judgements already decided by the interpretation engine. */
  signals: InterpretedSignal[]
  /** Extra structured context (session facts, budget, trends). Not raw logs. */
  context: Record<string, unknown>
  /** Free-text instructions scoped to this surface (e.g. Product §24 slots). */
  instructions?: string
  /**
   * Numbers produced by deterministic rules that are not MetricFacts, e.g. a
   * planned rep target ("10 + 5") from set_prescriptions. They may be repeated
   * but never computed. Coach patch 2026-09-27.
   */
  extraAllowedNumbers?: number[]
  /** Appended to the persisted prompt version when coach prompt v2 is used. */
  promptVersionSuffix?: string
  /**
   * Coach output guard: reject internal terms and an over-long summary, retry
   * once with the violation named. Defaults to false for backwards compatibility.
   */
  outputGuard?: boolean
  /**
   * spec A0-2: true once a surface's prompt writes `{{metric_key}}` instead of
   * digits (prompt v4+). false (default) keeps the free-number / traceable-
   * number check that today's v1–v3 prompts rely on.
   */
  placeholderMode?: boolean
  /**
   * spec A0-4 `context.allowed_actions`: the action_type values this
   * generation may choose from. Undefined/empty is a no-op check (the surface
   * does not use action_type yet).
   */
  allowedActions?: string[]
}

export interface ComposeSuccess {
  ok: true
  data: unknown
  model: string
  promptVersion: string
  evidenceRegistryVersion: string
  /** Correlation id so a rating can point at the exact input (AI Patch §32.1). */
  inputSnapshotId: string
}

export interface ComposeFailure {
  ok: false
  reason:
    | OpenAIFailureReason
    | 'unbound_evidence'
    | 'internal_term'
    | CheckFailure['code']
  detail?: string
  model: string
}

export type ComposeResult = ComposeSuccess | ComposeFailure

function buildSnapshotId(input: ComposeInput): string {
  // Deterministic on purpose: the same facts+signals+version produce the same
  // id, so a rating can be tied to an exact input without extra storage.
  const basis = JSON.stringify({
    surface: input.surface,
    facts: input.facts,
    signals: input.signals,
    context: input.context,
    registry: EVIDENCE_REGISTRY_VERSION,
  })
  let hash = 0
  for (let index = 0; index < basis.length; index += 1) {
    hash = (hash * 31 + basis.charCodeAt(index)) | 0
  }
  const positive = (hash >>> 0).toString(16).padStart(8, '0')
  return `${input.surface}:${EVIDENCE_REGISTRY_VERSION}:${positive}`
}

/**
 * AC-AI03: every below/above/caution/warning signal must resolve to a registry
 * item, or be explicitly attributed to a Pawside heuristic or a patch section.
 * An unbound status boundary is a guardrail violation, not a warning.
 */
export function findUnboundSignals(signals: InterpretedSignal[]): InterpretedSignal[] {
  const judgemental = new Set(['below_reference', 'above_reference', 'caution', 'warning'])
  const recognisedAuthority = /^(Product Patch|AI Patch|Method|Pawside heuristic|Guardrail)(?:\b|\s|§)/
  return signals.filter((signal) => {
    if (!judgemental.has(signal.status)) return false
    if (signal.evidence_ref_ids.length > 0) {
      // The id must actually exist in the registry, or the citation is fake.
      return !signal.evidence_ref_ids.every((id) => getEvidenceItem(id) !== null)
    }
    // A free-form non-empty string is not provenance. Without a registry item,
    // the authority must name one of the product's governed rule sources.
    return !recognisedAuthority.test(signal.authority.trim())
  })
}

/**
 * @deprecated Import from './output-checks' directly. Re-exported here only
 * because tests/nutrition/composer-guardrails.test.ts imports it from this
 * module's public surface.
 */
export { collectUserFacingStrings }

export const HEADLINE_MAX_CHARS = 30

/** The one-line headline of any surface (summary / overall / what_happened). */
export function headlineOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  for (const key of ['summary', 'overall']) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return null
}

/** @deprecated Use collectUserFacingStrings for AI numeric-integrity checks. */
export const collectStrings = collectUserFacingStrings

export async function composeWithEvidence(input: ComposeInput): Promise<ComposeResult> {
  const bundle = AI_SCHEMAS[input.surface]
  const config = getOpenAIConfigStatus()

  // Fail before spending a request when the evidence binding is already broken.
  const unbound = findUnboundSignals(input.signals)
  if (unbound.length > 0) {
    return {
      ok: false,
      reason: 'unbound_evidence',
      detail: unbound.map((signal) => `${signal.metric_key}:${signal.status}`).join(', '),
      model: config.model,
    }
  }

  const guard = input.outputGuard === true
  const basePayload = {
    surface: input.surface,
    facts: input.facts,
    computed_signals: input.signals,
    context: input.context,
    evidence_registry_version: EVIDENCE_REGISTRY_VERSION,
    instructions: guard
      ? `${input.instructions ?? ''}\n\n${COACH_SHARED_RULES}`
      : input.instructions ?? '',
  }

  /*
   * The composer passes `true` as the local validator because correctness is
   * enforced by the provider's strict JSON schema (additionalProperties:false,
   * required, enums) plus the numeric-integrity check below. Semantic checks
   * that a shape validator cannot express live in those two places instead of a
   * per-surface type guard.
   */
  async function attempt(correction: string | null): Promise<
    | { kind: 'provider_failure'; reason: OpenAIFailureReason; model: string }
    | { kind: 'checked'; data: unknown; model: string; hard: ComposeFailure | null; soft: string | null }
  > {
    const payload = correction
      ? { ...basePayload, instructions: `${basePayload.instructions}\n\n上一次输出不合格：${correction}。请重新生成，并修正这一点。` }
      : basePayload
    const result: OpenAIResult<unknown> = await callStructuredOutput<unknown>(
      AI_NUMERIC_INTEGRITY_RULES,
      JSON.stringify(payload, null, 2),
      bundle.name,
      bundle.schema,
      (value): value is unknown => value !== null && typeof value === 'object',
      bundle.maxOutputTokens,
    )
    if (!result.ok) return { kind: 'provider_failure', reason: result.reason, model: result.model }

    // spec A0-1 / A0-2 — the one shared output-checks pass: numeric integrity
    // (free-number or placeholder mode), forbidden claims (registry + global
    // guardrails), unknown evidence ids, status escalation, invalid actions.
    const checks = runOutputChecks({
      rawOutput: result.data,
      facts: input.facts.map((fact) => ({ metric_key: fact.metric_key, value: fact.value, unit: fact.unit })),
      signals: input.signals.map((signal) => ({
        metric_key: signal.metric_key,
        status: signal.status,
        evidence_ref_ids: signal.evidence_ref_ids,
      })),
      registry: buildOutputCheckRegistry(),
      placeholderMode: input.placeholderMode === true,
      extraAllowedNumbers: input.extraAllowedNumbers,
      allowedActions: input.allowedActions,
    })
    if (!checks.ok) {
      const first = checks.failures[0] as CheckFailure
      return {
        kind: 'checked',
        data: result.data,
        model: result.model,
        hard: { ok: false, reason: first.code, detail: retryHint(checks.failures), model: result.model },
        soft: null,
      }
    }
    const rendered = checks.rendered

    if (guard) {
      const texts = collectUserFacingStrings(rendered)
      const leaked = findInternalTerms(texts)
      if (leaked.length > 0) {
        return {
          kind: 'checked',
          data: rendered,
          model: result.model,
          hard: { ok: false, reason: 'internal_term', detail: leaked.join(', '), model: result.model },
          soft: null,
        }
      }
      const headline = headlineOf(rendered)
      if (headline !== null && [...headline].length > HEADLINE_MAX_CHARS) {
        return { kind: 'checked', data: rendered, model: result.model, hard: null, soft: `summary 超过 ${HEADLINE_MAX_CHARS} 个字` }
      }
    }

    return { kind: 'checked', data: rendered, model: result.model, hard: null, soft: null }
  }

  let outcome = await attempt(null)
  if (outcome.kind === 'provider_failure') {
    return { ok: false, reason: outcome.reason, model: outcome.model }
  }
  // One retry, on any hard failure (output-checks run unconditionally; the
  // coach guard adds internal_term/soft length on top), naming the violation.
  if (outcome.hard || (guard && outcome.soft)) {
    const correction = outcome.hard
      ? outcome.hard.reason === 'internal_term'
        ? `出现了内部用语（${outcome.hard.detail}）`
        : outcome.hard.detail ?? '输出不合格'
      : outcome.soft
    const second = await attempt(correction)
    if (second.kind === 'provider_failure') {
      return { ok: false, reason: second.reason, model: second.model }
    }
    outcome = second
  }
  if (outcome.hard) return outcome.hard
  // A soft issue (length) that survives the retry is accepted rather than
  // truncated: a cut-off sentence is worse than a long one.

  const result = { data: outcome.data, model: outcome.model }

  return {
    ok: true,
    data: result.data,
    model: result.model,
    promptVersion: input.promptVersionSuffix
      ? `${bundle.promptVersion}+${input.promptVersionSuffix}`
      : bundle.promptVersion,
    evidenceRegistryVersion: EVIDENCE_REGISTRY_VERSION,
    inputSnapshotId: buildSnapshotId(input),
  }
}
