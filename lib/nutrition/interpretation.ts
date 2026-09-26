/**
 * Pawside — Metric Fact and Interpreted Signal contracts.
 *
 * Authority:
 *   AI Patch §22 — MetricFact
 *   AI Patch §23 — InterpretedSignal
 *   AI Patch §24 — "reasonable" is not one enum: the domain of the judgement
 *                  must be recorded (health_guideline vs training_optimization
 *                  vs user_target vs data_quality vs subjective_recovery vs
 *                  safety_signal)
 *   AI Patch §31 — Trusted Numeric Fact vs AI-generated Number
 *   Guardrail §12 — `0` and `not recorded` are different states
 */

export type MetricWindow = 'session' | 'day' | 'week' | 'rolling_7d'

export type DataCompleteness = 'complete' | 'partial' | 'unknown'

/**
 * A deterministic fact. `value: null` means NOT MEASURABLE, which is a
 * different statement from `value: 0` (measured zero). Callers must not
 * coalesce the two.
 */
export interface MetricFact {
  metric_key: string
  value: number | null
  unit: string | null
  window: MetricWindow
  /** How the value was produced. Required so a number can be reproduced. */
  calculation_basis: unknown
  data_completeness: DataCompleteness
}

export type InterpretedStatus =
  | 'within_reference'
  | 'below_reference'
  | 'above_reference'
  | 'caution'
  | 'warning'
  | 'insufficient_data'
  | 'not_assessable'

/**
 * Source: AI Patch §24 — what kind of statement this is. A training-volume
 * observation is NOT a health statement, and the AI must not upgrade it.
 */
export type JudgementDomain =
  | 'health_guideline'
  | 'training_optimization'
  | 'user_target'
  | 'data_quality'
  | 'subjective_recovery'
  | 'safety_signal'

export type EvidenceLevel = 'A' | 'B' | 'C' | 'D'

export interface InterpretedSignal {
  metric_key: string
  status: InterpretedStatus
  /** AI Patch §24: without this, a training note can be misread as medical. */
  domain: JudgementDomain
  evidence_ref_ids: string[]
  evidence_level: EvidenceLevel | null
  confidence: 'high' | 'medium' | 'low'
  /**
   * The single sentence this signal permits. `null` means "do not say anything
   * about this metric" — which is the correct output when data is missing
   * (Product §27 / AC-P15), not a neutral placeholder.
   */
  allowed_claim: string | null
  /** Patch section or Method rule that authorises this boundary. */
  authority: string
}

/**
 * AI Patch §31 numeric integrity.
 *
 * Every number a user sees must be traceable. AI output may only reference
 * numbers that exist in the supplied facts; anything else is rejected rather
 * than displayed. Returns the offending tokens so the caller can log them.
 */
export function findUntraceableNumbers(
  text: string,
  allowedValues: Array<number | null | undefined>,
): string[] {
  const allowed = new Set<string>()
  for (const value of allowedValues) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    allowed.add(String(value))
    allowed.add(String(Math.round(value)))
    // One decimal place, matching what the generators persist.
    allowed.add(String(Math.round(value * 10) / 10))
    allowed.add(value.toFixed(1))
  }

  const found = text.match(/\d+(?:\.\d+)?/g) ?? []
  return found.filter((token) => !allowed.has(token))
}

/**
 * Convenience guard for AI payloads: true when every number in `text` can be
 * mapped back to a supplied MetricFact.
 */
export function hasTraceableNumbers(
  text: string,
  allowedValues: Array<number | null | undefined>,
): boolean {
  return findUntraceableNumbers(text, allowedValues).length === 0
}
