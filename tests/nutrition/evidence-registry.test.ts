import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_ITEMS,
  EVIDENCE_REGISTRY_VERSION,
  claimStyleForLevel,
  getEvidenceForMetric,
  getEvidenceItem,
  resolveCitations,
  validateRegistry,
} from '../../lib/evidence/registry.ts'
import {
  interpretCalorieSafety,
  interpretEnergyAvailability,
  interpretHypertrophyVolume,
  interpretRecovery,
  interpretWeeklyAerobic,
  validateNumericIntegrity,
} from '../../lib/evidence/interpret.ts'
import { metricFact } from '../../lib/evidence/interpret.ts'

/** Phase E verification — Evidence Registry and interpretation boundaries. */

describe('Evidence Registry integrity (AI Patch §4)', () => {
  it('passes its own validator', () => {
    // A duplicate id or a missing claim boundary would make "every judgement is
    // explainable" unverifiable, so this is a hard gate.
    expect(validateRegistry()).toEqual([])
  })

  it('gives every item allowed AND forbidden claims plus applicability notes', () => {
    for (const item of EVIDENCE_ITEMS) {
      expect(item.allowed_claims.length).toBeGreaterThan(0)
      expect(item.forbidden_claims.length).toBeGreaterThan(0)
      expect(item.applicability_notes.length).toBeGreaterThan(0)
    }
  })

  it('carries a version so generated content stays auditable', () => {
    expect(EVIDENCE_REGISTRY_VERSION).toBe('evidence_v0')
  })

  it('records the universal calorie floor as nonexistent (AC-AI07)', () => {
    const item = getEvidenceItem('E-NUT-SAFE-001')
    expect(item?.reference_type).toBe('no_universal_threshold')
    // It must not smuggle in a numeric floor while claiming there is none.
    expect(item?.reference_value).toBeUndefined()
  })

  it('exposes the forbidden claims that protect the product', () => {
    const recovery = getEvidenceItem('E-REC-001')
    for (const forbidden of ['过度训练', '医学恢复不良', '睡眠障碍', '今天禁止训练']) {
      expect(recovery?.forbidden_claims).toContain(forbidden)
    }

    const aerobic = getEvidenceItem('E-ACT-001')
    expect(aerobic?.forbidden_claims.join(' ')).toContain('已达到 WHO')
  })

  it('returns nothing for an unregistered metric', () => {
    // AI Patch §1.1: no registry item means not_assessable, not a guess.
    expect(getEvidenceForMetric('made.up.metric')).toEqual([])
  })
})

describe('claim strength follows evidence level (Product §25.2 / AC-AI06)', () => {
  it('phrases a guideline differently from a Pawside heuristic', () => {
    const guideline = claimStyleForLevel('A')
    const pawside = claimStyleForLevel('D')

    expect(guideline.style).toBe('guideline')
    expect(guideline.mustLabelAsPawside).toBe(false)
    expect(pawside.style).toBe('pawside')
    // The 1.6 g/kg target is Evidence D and must never read as a requirement.
    expect(pawside.mustLabelAsPawside).toBe(true)
  })

  it('does not let a missing level borrow guideline authority', () => {
    expect(claimStyleForLevel(null).mustLabelAsPawside).toBe(true)
  })
})

describe('resolveCitations (AI Patch §30 / AC-AI12)', () => {
  it('resolves refs to real registry sources', () => {
    const citations = resolveCitations(['E-RT-002', 'E-NUT-PROTEIN-OP'])
    expect(citations).toHaveLength(2)
    expect(citations[0].source_org).toBe('ACSM')
    expect(citations[1].source_org).toBe('Pawside')
  })

  it('drops unknown refs instead of inventing a source', () => {
    // A hallucinated id must yield no citation rather than a fabricated URL.
    expect(resolveCitations(['E-DOES-NOT-EXIST'])).toEqual([])
  })
})

describe('interpretWeeklyAerobic (AC-AI05)', () => {
  const fact = metricFact({
    metricKey: 'activity.weekly_aerobic',
    value: 200,
    unit: 'min',
    window: 'week',
    calculationBasis: {},
    dataCompleteness: 'complete',
  })

  it('refuses to claim the WHO aerobic guideline without intensity data', () => {
    // 200 minutes is inside the WHO 150-300 range, but intensity is unknown,
    // so the guideline must NOT be applied.
    const signal = interpretWeeklyAerobic(fact)
    expect(signal.status).toBe('not_assessable')
    expect(signal.authority).toContain('AC-AI05')
  })
})

describe('interpretHypertrophyVolume (AI Patch §24 / AC-AI04)', () => {
  const fact = metricFact({
    metricKey: 'training.hypertrophy_volume',
    value: 6,
    unit: 'sets',
    window: 'week',
    calculationBasis: {},
    dataCompleteness: 'complete',
  })

  it('is not_assessable when no muscle-group mapping exists', () => {
    const signal = interpretHypertrophyVolume(fact, { muscleGroupMappingAvailable: false })
    expect(signal.status).toBe('not_assessable')
  })

  it('uses the training_optimization domain, never health_guideline', () => {
    const signal = interpretHypertrophyVolume(fact, { muscleGroupMappingAvailable: true })
    expect(signal.status).toBe('below_reference')
    expect(signal.domain).toBe('training_optimization')
  })
})

describe('interpretCalorieSafety (AI Patch §16.1 / AC-AI08)', () => {
  const fact = metricFact({
    metricKey: 'nutrition.calorie_safety',
    value: 1200,
    unit: 'kcal',
    window: 'day',
    calculationBasis: {},
    dataCompleteness: 'complete',
  })

  it('returns not_assessable when age is missing rather than omitting it', () => {
    const signal = interpretCalorieSafety(fact, { sex: 'female', age: null })
    expect(signal.status).toBe('not_assessable')
    expect(signal.allowed_claim).toContain('age')
  })

  it('does not turn a low intake into a danger verdict (AC-AI07)', () => {
    const signal = interpretCalorieSafety(fact, { sex: 'female', age: 30 })
    // Even with complete demographics there is no universal floor to compare to.
    expect(signal.status).toBe('not_assessable')
    expect(signal.allowed_claim).toBeNull()
  })
})

describe('interpretEnergyAvailability (AI Patch §18)', () => {
  it('is not_assessable by policy in V1', () => {
    const signal = interpretEnergyAvailability()
    expect(signal.status).toBe('not_assessable')
    expect(signal.authority).toContain('§18')
  })
})

describe('interpretRecovery (AI Patch §19)', () => {
  it('says not recorded instead of defaulting', () => {
    const signal = interpretRecovery(metricFact({
      metricKey: 'recovery.self_report',
      value: null,
      unit: null,
      window: 'day',
      calculationBasis: {},
      dataCompleteness: 'unknown',
    }))
    expect(signal.status).toBe('not_assessable')
    expect(signal.allowed_claim).toBe('今日未记录主观恢复')
  })

  it('uses only the permitted subjective wording', () => {
    for (const value of [1, 3, 5]) {
      const signal = interpretRecovery(metricFact({
        metricKey: 'recovery.self_report',
        value,
        unit: null,
        window: 'day',
        calculationBasis: {},
        dataCompleteness: 'complete',
      }))
      for (const forbidden of ['过度训练', '医学恢复不良', '禁止训练']) {
        expect(signal.allowed_claim ?? '').not.toContain(forbidden)
      }
    }
  })
})

describe('validateNumericIntegrity (AI Patch §31)', () => {
  const facts = [
    metricFact({ metricKey: 'a', value: 86, unit: 'g', window: 'day', calculationBasis: {}, dataCompleteness: 'complete' }),
    metricFact({ metricKey: 'b', value: 1540, unit: 'kcal', window: 'day', calculationBasis: {}, dataCompleteness: 'complete' }),
  ]

  it('accepts text whose numbers all come from the facts', () => {
    expect(validateNumericIntegrity(['今天摄入 1540 kcal，蛋白质 86g'], facts).ok).toBe(true)
  })

  it('rejects a number the model invented', () => {
    const result = validateNumericIntegrity(['今天摄入 1540 kcal，蛋白质 99g'], facts)
    expect(result.ok).toBe(false)
    expect(result.untraceable).toContain('99')
  })

  it('rejects a fabricated food weight', () => {
    // §26: the AI may not convert remaining protein into grams of chicken.
    const result = validateNumericIntegrity(['还差约 300g 鸡胸肉'], facts)
    expect(result.ok).toBe(false)
    expect(result.untraceable).toContain('300')
  })

  it('ignores text with no numbers', () => {
    expect(validateNumericIntegrity(['今天记录得不错'], facts).ok).toBe(true)
  })
})
