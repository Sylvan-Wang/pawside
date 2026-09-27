import { describe, expect, it } from 'vitest'
import {
  findBareNumbers,
  findEscalatedStatuses,
  findForbiddenClaims,
  findInvalidActionTypes,
  findUnknownEvidenceIds,
  findUntraceableNumbersInOutput,
  renderOutput,
  runOutputChecks,
  type RegistryLike,
} from '../../lib/evidence/output-checks.ts'

const registry: RegistryLike = {
  ids: new Set(['E-PROTEIN-001', 'E-RECOVERY-001']),
  forbiddenClaims: new Map([
    ['E-PROTEIN-001', ['官方规定你必须吃 XXg']],
    ['E-RECOVERY-001', ['你训练过度', '训练量必须降低 X%']],
  ]),
  globalForbidden: ['医学诊断'],
}

const facts = [
  { metric_key: 'nutrition.protein_remaining', value: 42, unit: 'g' },
  { metric_key: 'nutrition.protein_target', value: 130.25, unit: 'g' },
]

describe('placeholder rendering', () => {
  it('substitutes facts and rounds to one decimal', () => {
    const { output, unresolved } = renderOutput(
      { summary: '还差 {{nutrition.protein_remaining}}，目标 {{nutrition.protein_target}}' },
      facts,
    )
    expect(output.summary).toBe('还差 42 g，目标 130.3 g')
    expect(unresolved).toEqual([])
  })

  it('reports placeholders that do not match a fact', () => {
    const { unresolved } = renderOutput({ summary: '{{nutrition.fiber_remaining}}' }, facts)
    expect(unresolved).toEqual(['nutrition.fiber_remaining'])
  })

  it('leaves machine fields untouched', () => {
    const { output } = renderOutput({ signal_key: '{{x}}', text: 'ok' }, facts)
    expect(output.signal_key).toBe('{{x}}')
  })
})

describe('bare numbers (placeholder mode)', () => {
  it('catches the small integers and dates that break the current gate', () => {
    expect(findBareNumbers({ a: '补 1 份蛋白', b: '9 月 25 日', c: '最多 ２ 组' })).toEqual(['1', '9', '25', '2'])
  })

  it('ignores digits inside placeholders and machine fields', () => {
    expect(findBareNumbers({ text: '{{nutrition.protein_remaining}}', evidence_ref_ids: ['E-001'] })).toEqual([])
  })
})

describe('untraceable numbers (free-number mode, spec A0-1)', () => {
  // Migrated from tests/nutrition/evidence-registry.test.ts — this is the
  // single implementation now (lib/nutrition/interpretation.ts and
  // lib/evidence/interpret.ts's copies were retired).
  const allowed = [86, 1540]

  it('accepts text whose numbers all come from the facts', () => {
    expect(findUntraceableNumbersInOutput({ t: '今天摄入 1540 kcal，蛋白质 86g' }, allowed)).toEqual([])
  })

  it('rejects a number the model invented', () => {
    expect(findUntraceableNumbersInOutput({ t: '今天摄入 1540 kcal，蛋白质 99g' }, allowed)).toContain('99')
  })

  it('rejects a fabricated food weight (§26: no gram conversion)', () => {
    expect(findUntraceableNumbersInOutput({ t: '还差约 300g 鸡胸肉' }, allowed)).toContain('300')
  })

  it('ignores text with no numbers', () => {
    expect(findUntraceableNumbersInOutput({ t: '今天记录得不错' }, allowed)).toEqual([])
  })
})

describe('forbidden claims', () => {
  const signals = [{ metric_key: 'recovery.self_report', status: 'caution', evidence_ref_ids: ['E-RECOVERY-001'] }]

  it('matches claims of evidence ids in play, with X wildcards', () => {
    const hits = findForbiddenClaims({ t: '建议训练量必须降低 20%' }, signals, registry)
    expect(hits).toEqual(['训练量必须降低 X%'])
  })

  it('ignores whitespace differences', () => {
    expect(findForbiddenClaims({ t: '你 训练 过度了' }, signals, registry)).toContain('你训练过度')
  })

  it('does not apply claims of evidence ids that were not supplied', () => {
    expect(findForbiddenClaims({ t: '官方规定你必须吃 120g' }, signals, registry)).toEqual([])
  })

  it('always applies global guardrails', () => {
    expect(findForbiddenClaims({ t: '这不是医学诊断' }, [], registry)).toEqual(['医学诊断'])
  })
})

describe('evidence ids', () => {
  const signals = [{ metric_key: 'nutrition.protein', status: 'below_reference', evidence_ref_ids: ['E-PROTEIN-001'] }]

  it('rejects ids that exist but were not supplied, and ids that do not exist', () => {
    const out = { observations: [{ evidence_ref_ids: ['E-PROTEIN-001', 'E-RECOVERY-001', 'E-FAKE'] }] }
    expect(findUnknownEvidenceIds(out, signals, registry)).toEqual(['E-RECOVERY-001', 'E-FAKE'])
  })
})

describe('status escalation', () => {
  const signals = [
    { metric_key: 'nutrition.protein', status: 'below_reference', evidence_ref_ids: [] },
    { metric_key: 'training.volume', status: 'not_assessable', evidence_ref_ids: [] },
  ]

  it('blocks a stronger judgement than the rule made', () => {
    const out = { observations: [{ signal_key: 'nutrition.protein', status: 'warning' }] }
    expect(findEscalatedStatuses(out, signals)).toEqual(['nutrition.protein:below_reference->warning'])
  })

  it('blocks turning not_assessable into any judgement', () => {
    const out = { observations: [{ signal_key: 'training.volume', status: 'below_reference' }] }
    expect(findEscalatedStatuses(out, signals)).toHaveLength(1)
  })

  it('blocks observations about signals that were never supplied', () => {
    const out = { observations: [{ signal_key: 'body.fat', status: 'ok' }] }
    expect(findEscalatedStatuses(out, signals)).toEqual(['body.fat:not_supplied'])
  })

  it('also reads coach_output_v1 evidence[] (spec A0-4), not just observations[]', () => {
    const out = { evidence: [{ signal_key: 'nutrition.protein', status: 'warning' }] }
    expect(findEscalatedStatuses(out, signals)).toEqual(['nutrition.protein:below_reference->warning'])
  })
})

describe('invalid action types', () => {
  it('rejects an action_type outside the allowed list for this generation', () => {
    const out = { next_actions: [{ action_type: 'log_meal' }, { action_type: 'delete_account' }] }
    expect(findInvalidActionTypes(out, ['log_meal', 'view_next_session'])).toEqual(['delete_account'])
  })

  it('is a no-op when the surface does not supply allowed_actions yet', () => {
    const out = { next_actions: [{ action_type: 'anything' }] }
    expect(findInvalidActionTypes(out, undefined)).toEqual([])
    expect(findInvalidActionTypes(out, [])).toEqual([])
  })
})

describe('runOutputChecks', () => {
  it('passes a clean placeholder-mode output', () => {
    const r = runOutputChecks({
      rawOutput: { summary: '还差 {{nutrition.protein_remaining}}，晚餐补一份高蛋白。' },
      facts, signals: [], registry, placeholderMode: true,
    })
    expect(r.ok).toBe(true)
    expect((r.rendered as { summary: string }).summary).toContain('42 g')
  })

  it('passes a clean free-number output whose numbers are all traceable', () => {
    const r = runOutputChecks({
      rawOutput: { summary: '今天蛋白还差 42g' },
      facts, signals: [], registry, placeholderMode: false,
    })
    expect(r.ok).toBe(true)
  })

  it('fails free-number mode on an untraceable number, with a reason', () => {
    const r = runOutputChecks({
      rawOutput: { summary: '今天蛋白还差 99g' },
      facts, signals: [], registry, placeholderMode: false,
    })
    expect(r.ok).toBe(false)
    expect(r.failures[0].code).toBe('untraceable_number')
  })

  it('rejects a forbidden claim even when the numeric check passes', () => {
    const signals = [{ metric_key: 'recovery.self_report', status: 'caution', evidence_ref_ids: ['E-RECOVERY-001'] }]
    const r = runOutputChecks({
      rawOutput: { summary: '你训练过度了' },
      facts: [], signals, registry, placeholderMode: false,
    })
    expect(r.ok).toBe(false)
    expect(r.failures.map((f) => f.code)).toContain('forbidden_claim')
  })
})
