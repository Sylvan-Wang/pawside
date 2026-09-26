import {
  callStructuredOutput,
  getOpenAIConfigStatus,
  type OpenAIFailureReason,
  type OpenAIResult,
} from '../ai-client'
import { EVIDENCE_REGISTRY_VERSION, getEvidenceItem } from './registry'
import {
  AI_SCHEMAS,
  AI_NUMERIC_INTEGRITY_RULES,
  type AiSurface,
} from './ai-schemas'
import type { InterpretedSignal, MetricFact } from '../nutrition/interpretation'

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
  reason: OpenAIFailureReason | 'unbound_evidence' | 'untraceable_number'
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

/** Collects every number the model is allowed to state. */
function allowedNumbers(input: ComposeInput): number[] {
  const numbers: number[] = []
  for (const fact of input.facts) {
    if (fact.value !== null && Number.isFinite(fact.value)) numbers.push(fact.value)
  }
  return numbers
}

/**
 * AI Patch §31 — walk the produced payload and reject any number that cannot be
 * traced back to a supplied MetricFact. Small integers that are structural
 * rather than claims (counts already in the facts) are covered because the facts
 * carry them.
 */
const MACHINE_TEXT_KEYS = new Set([
  'evidence_ref_ids',
  'signal_key',
  'metric_key',
  'status',
  'domain',
  'basis',
  'direction',
  'level',
])

export function collectUserFacingStrings(
  value: unknown,
  out: string[] = [],
  parentKey: string | null = null,
): string[] {
  if (typeof value === 'string') {
    if (!parentKey || !MACHINE_TEXT_KEYS.has(parentKey)) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUserFacingStrings(item, out, parentKey)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      collectUserFacingStrings(item, out, key)
    }
  }
  return out
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

  const payload = {
    surface: input.surface,
    facts: input.facts,
    computed_signals: input.signals,
    context: input.context,
    evidence_registry_version: EVIDENCE_REGISTRY_VERSION,
    instructions: input.instructions ?? '',
  }

  /*
   * The composer passes `true` as the local validator because correctness is
   * enforced by the provider's strict JSON schema (additionalProperties:false,
   * required, enums) plus the numeric-integrity check below. Semantic checks
   * that a shape validator cannot express live in those two places instead of a
   * per-surface type guard.
   */
  const result: OpenAIResult<unknown> = await callStructuredOutput<unknown>(
    AI_NUMERIC_INTEGRITY_RULES,
    JSON.stringify(payload, null, 2),
    bundle.name,
    bundle.schema,
    (value): value is unknown => value !== null && typeof value === 'object',
    bundle.maxOutputTokens,
  )

  if (!result.ok) {
    return { ok: false, reason: result.reason, model: result.model }
  }

  // AI Patch §31: strip/reject untraceable numbers.
  const texts = collectUserFacingStrings(result.data)
  const allowed = allowedNumbers(input)
  const untraceable: string[] = []
  for (const text of texts) {
    for (const token of text.match(/\d+(?:\.\d+)?/g) ?? []) {
      const numeric = Number(token)
      const traceable = allowed.some(
        (value) => value === numeric
          || Math.round(value) === numeric
          || Math.round(value * 10) / 10 === numeric,
      )
      if (!traceable && !untraceable.includes(token)) untraceable.push(token)
    }
  }

  if (untraceable.length > 0) {
    return {
      ok: false,
      reason: 'untraceable_number',
      detail: untraceable.join(', '),
      model: result.model,
    }
  }

  return {
    ok: true,
    data: result.data,
    model: result.model,
    promptVersion: bundle.promptVersion,
    evidenceRegistryVersion: EVIDENCE_REGISTRY_VERSION,
    inputSnapshotId: buildSnapshotId(input),
  }
}
