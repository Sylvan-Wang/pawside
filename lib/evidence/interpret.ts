import {
  claimStyleForLevel,
  getEvidenceForMetric,
  type EvidenceLevel,
  type EvidenceRegistryItem,
} from './registry'
import {
  findUntraceableNumbers,
  type DataCompleteness,
  type InterpretedSignal,
  type InterpretedStatus,
  type JudgementDomain,
  type MetricFact,
  type MetricWindow,
} from '../nutrition/interpretation'

/**
 * Pawside — Interpretation Engine (AI Patch §23, §24, §31).
 *
 * Turns a MetricFact + the Evidence Registry into an InterpretedSignal.
 *
 * Hard rules enforced here:
 *   AI Patch §1.1 / Guardrail §1.1 — no registry item means `not_assessable`.
 *     The engine never falls back to a plausible number.
 *   AI Patch §24 — the domain is explicit, so a training-optimisation remark
 *     can never be rendered as a health statement.
 *   AC-AI03 — every below/above/warning status carries evidence_ref_ids, or is
 *     explicitly marked as a Pawside heuristic.
 */

export interface InterpretContext {
  /** Free-form context the rule may need (goal, sex, training history). */
  goal?: string | null
  sex?: string | null
  /** Age is absent from onboarding; a rule needing it must not_assess. */
  age?: number | null
  hasTrainingHistory?: boolean
}

/** Builds a MetricFact with an explicit completeness, never a guessed value. */
export function metricFact(input: {
  metricKey: string
  value: number | null
  unit: string | null
  window: MetricWindow
  calculationBasis: unknown
  dataCompleteness: DataCompleteness
}): MetricFact {
  return {
    metric_key: input.metricKey,
    value: input.value,
    unit: input.unit,
    window: input.window,
    calculation_basis: input.calculationBasis,
    data_completeness: input.dataCompleteness,
  }
}

function signal(input: {
  metricKey: string
  status: InterpretedStatus
  domain: JudgementDomain
  item?: EvidenceRegistryItem | null
  confidence?: InterpretedSignal['confidence']
  allowedClaim?: string | null
  authority: string
}): InterpretedSignal {
  return {
    metric_key: input.metricKey,
    status: input.status,
    domain: input.domain,
    evidence_ref_ids: input.item ? [input.item.evidence_id] : [],
    evidence_level: (input.item?.evidence_level ?? null) as EvidenceLevel | null,
    confidence: input.confidence ?? 'medium',
    allowed_claim: input.allowedClaim ?? null,
    authority: input.authority,
  }
}

/**
 * E-ACT-001 / AC-AI05.
 *
 * The Workout Log has no `aerobic_intensity` field, so weekly minutes can be
 * reported as a fact but MUST NOT be compared against the WHO aerobic guideline.
 * This is the single most tempting place to over-claim, so it is modelled
 * explicitly rather than left to a prompt instruction.
 */
export function interpretWeeklyAerobic(fact: MetricFact): InterpretedSignal {
  if (fact.value === null) {
    return signal({
      metricKey: fact.metric_key,
      status: 'insufficient_data',
      domain: 'health_guideline',
      item: null,
      allowedClaim: null,
      authority: 'AI Patch §6.1 / AC-AI05',
    })
  }

  return signal({
    metricKey: 'activity.weekly_aerobic',
    // Deliberately not_assessable: intensity is unknown, so the guideline cannot
    // be applied even though the minutes are known.
    status: 'not_assessable',
    domain: 'health_guideline',
    item: getEvidenceForMetric('activity.weekly_aerobic')[0] ?? null,
    allowedClaim: '本周有记录的训练分钟数（未区分强度）',
    authority: 'AI Patch §6.1 / AC-AI05',
  })
}

/** E-ACT-001 strength frequency. Needs muscle-group coverage to claim success. */
export function interpretStrengthFrequency(
  fact: MetricFact,
  context: InterpretContext,
): InterpretedSignal {
  const item = getEvidenceForMetric('training.strength_frequency')[0] ?? null

  if (fact.value === null) {
    return signal({
      metricKey: fact.metric_key,
      status: 'insufficient_data',
      domain: 'health_guideline',
      item,
      allowedClaim: null,
      authority: 'AI Patch §7',
    })
  }

  const minimum = 2
  if (fact.value < minimum) {
    return signal({
      metricKey: fact.metric_key,
      status: 'below_reference',
      domain: 'health_guideline',
      item,
      allowedClaim: item?.allowed_claims[0] ?? null,
      authority: 'AI Patch §7 (E-RT-001)',
    })
  }

  // Meeting the frequency minimum is NOT evidence that all major muscle groups
  // were covered — the registry forbids that claim.
  return signal({
    metricKey: fact.metric_key,
    status: 'within_reference',
    domain: 'health_guideline',
    item,
    allowedClaim: context.hasTrainingHistory
      ? '已达到一般成年人力量训练建议频率'
      : null,
    authority: 'AI Patch §7',
  })
}

/**
 * E-RT-002. Volume is a TRAINING OPTIMISATION judgement, never a health one
 * (AI Patch §24 / AC-AI04). Returns not_assessable when no muscle-group mapping
 * exists, because Pawside cannot currently attribute sets to a muscle group.
 */
export function interpretHypertrophyVolume(
  fact: MetricFact,
  options: { muscleGroupMappingAvailable: boolean; goal?: string | null },
): InterpretedSignal {
  const item = getEvidenceForMetric('training.hypertrophy_volume')[0] ?? null

  if (!options.muscleGroupMappingAvailable) {
    return signal({
      metricKey: 'training.hypertrophy_volume',
      status: 'not_assessable',
      domain: 'training_optimization',
      item,
      allowedClaim: null,
      authority: 'AI Patch §7 (muscle-group mapping unavailable)',
    })
  }

  if (fact.value === null) {
    return signal({
      metricKey: fact.metric_key,
      status: 'insufficient_data',
      domain: 'training_optimization',
      item,
      allowedClaim: null,
      authority: 'AI Patch §7',
    })
  }

  const target = 10
  if (fact.value < target) {
    return signal({
      metricKey: fact.metric_key,
      status: 'below_reference',
      domain: 'training_optimization',
      item,
      allowedClaim: item?.allowed_claims[0] ?? null,
      authority: 'AI Patch §7 (E-RT-002)',
    })
  }

  return signal({
    metricKey: fact.metric_key,
    status: 'within_reference',
    domain: 'training_optimization',
    item,
    allowedClaim: item?.allowed_claims[0] ?? null,
    authority: 'AI Patch §7 (E-RT-002)',
  })
}

/**
 * E-NUT-PROTEIN-OP. Protein is compared against the user's own derived target,
 * which is a Pawside operational point (Evidence D), so the claim must be
 * labelled as Pawside's, not as a requirement (AC-AI06).
 */
export function interpretProteinTarget(fact: MetricFact): InterpretedSignal {
  const item = getEvidenceForMetric('nutrition.protein_target')[0] ?? null
  const style = claimStyleForLevel(item?.evidence_level ?? null)

  if (fact.value === null) {
    return signal({
      metricKey: fact.metric_key,
      status: 'insufficient_data',
      domain: 'user_target',
      item,
      allowedClaim: null,
      authority: 'Product Patch §27',
    })
  }

  return signal({
    metricKey: fact.metric_key,
    status: 'within_reference',
    domain: 'user_target',
    item,
    allowedClaim: `${style.prefix}的蛋白质参考为 ${fact.value} g/天`,
    authority: 'AI Patch §11.1 / AC-AI06',
  })
}

/**
 * E-NUT-SAFE-001 / E-NUT-SAFE-002.
 *
 * Returns `not_assessable` unless every input the formula needs is present.
 * AC-AI08: a missing `age` must NOT be silently omitted to produce a
 * confidently wrong individual RMR.
 */
export function interpretCalorieSafety(
  fact: MetricFact,
  context: InterpretContext,
): InterpretedSignal {
  const safetyItem = getEvidenceForMetric('nutrition.calorie_safety')[0] ?? null
  const rmrItem = getEvidenceForMetric('nutrition.rmr_estimate')[0] ?? null

  const missing: string[] = []
  if (context.age === null || context.age === undefined) missing.push('age')
  if (!context.sex) missing.push('sex')

  if (missing.length > 0) {
    return signal({
      metricKey: 'nutrition.calorie_safety',
      status: 'not_assessable',
      domain: 'safety_signal',
      item: rmrItem ?? safetyItem,
      // Say why, so a future contributor does not "fix" it by guessing.
      allowedClaim: `个体化能量参考需要 ${missing.join('、')}，当前资料不足，暂无法评估`,
      authority: 'AI Patch §16.1 / AC-AI08',
    })
  }

  // There is no universal floor to compare against (E-NUT-SAFE-001).
  return signal({
    metricKey: 'nutrition.calorie_safety',
    status: 'not_assessable',
    domain: 'safety_signal',
    item: safetyItem,
    allowedClaim: null,
    authority: 'AI Patch §14 / AC-AI07',
  })
}

/** E-SESSION-001. Duration anomalies are data quality, never health (§8). */
export function interpretSessionDuration(fact: MetricFact, flag: string | null): InterpretedSignal {
  const item = getEvidenceForMetric('training.session_duration')[0] ?? null

  if (flag === null) {
    return signal({
      metricKey: fact.metric_key,
      status: 'within_reference',
      domain: 'data_quality',
      item,
      allowedClaim: null,
      authority: 'AI Patch §8',
    })
  }

  return signal({
    metricKey: fact.metric_key,
    status: 'caution',
    domain: 'data_quality',
    item,
    allowedClaim: item?.allowed_claims[0] ?? null,
    authority: 'AI Patch §8 (E-SESSION-001)',
  })
}

/** E-SESSION-002. Record completeness is data quality (Product §13 Layer B). */
export function interpretRecordCompleteness(
  fact: MetricFact,
  completeness: 'none' | 'name_only' | 'partial' | 'full' | 'unknown',
): InterpretedSignal {
  const item = getEvidenceForMetric('training.record_completeness')[0] ?? null

  if (completeness === 'full') {
    return signal({
      metricKey: fact.metric_key,
      status: 'within_reference',
      domain: 'data_quality',
      item,
      allowedClaim: null,
      authority: 'Product Patch §13',
    })
  }

  return signal({
    metricKey: fact.metric_key,
    status: 'insufficient_data',
    domain: 'data_quality',
    item,
    allowedClaim: item?.allowed_claims[0] ?? null,
    authority: 'Product Patch §13 (E-SESSION-002)',
  })
}

/** E-REC-001. Subjective recovery is context only (AI Patch §19). */
export function interpretRecovery(fact: MetricFact): InterpretedSignal {
  const item = getEvidenceForMetric('recovery.self_report')[0] ?? null

  if (fact.value === null) {
    return signal({
      metricKey: fact.metric_key,
      status: 'not_assessable',
      domain: 'subjective_recovery',
      item,
      // Product §27: "今日未记录主观恢复" rather than a default.
      allowedClaim: '今日未记录主观恢复',
      authority: 'Product Patch §27',
    })
  }

  const claim = fact.value <= 2
    ? item?.allowed_claims[0]
    : fact.value === 3
      ? item?.allowed_claims[1]
      : item?.allowed_claims[2]

  return signal({
    metricKey: fact.metric_key,
    status: fact.value <= 2 ? 'below_reference' : 'within_reference',
    domain: 'subjective_recovery',
    item,
    allowedClaim: claim ?? null,
    confidence: 'high',
    authority: 'AI Patch §19 (E-REC-001)',
  })
}

/**
 * E-NUT-SAFE-003 / AI Patch §18.
 *
 * Complete Energy Availability needs intake, exercise expenditure and FFM.
 * Pawside V1 has none of these reliably, so EA is `not_assessable` by policy
 * rather than by missing input.
 */
export function interpretEnergyAvailability(): InterpretedSignal {
  const item = getEvidenceForMetric('nutrition.energy_availability')[0] ?? null
  return signal({
    metricKey: 'nutrition.energy_availability',
    status: 'not_assessable',
    domain: 'safety_signal',
    item,
    allowedClaim: null,
    authority: 'AI Patch §18',
  })
}

/**
 * AI Patch §31 — numeric integrity gate.
 *
 * Verifies that every number an AI payload states can be traced back to a
 * supplied MetricFact. Any untraceable number means the output must be rejected
 * or stripped, never displayed.
 */
export function validateNumericIntegrity(
  texts: string[],
  facts: MetricFact[],
): { ok: boolean; untraceable: string[] } {
  const allowed = facts.map((fact) => fact.value)
  const untraceable = texts.flatMap((text) => findUntraceableNumbers(text, allowed))
  return { ok: untraceable.length === 0, untraceable }
}
