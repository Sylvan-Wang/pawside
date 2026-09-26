import { describe, expect, it } from 'vitest'
import {
  collectUserFacingStrings,
  findUnboundSignals,
} from '../../lib/evidence/composer.ts'
import type { InterpretedSignal } from '../../lib/nutrition/interpretation.ts'

function signal(overrides: Partial<InterpretedSignal> = {}): InterpretedSignal {
  return {
    metric_key: 'training.session_duration',
    status: 'caution',
    domain: 'data_quality',
    evidence_ref_ids: [],
    evidence_level: null,
    confidence: 'medium',
    allowed_claim: '记录可能不完整',
    authority: 'Product Patch §13',
    ...overrides,
  }
}

describe('Composer guardrails', () => {
  it('does not parse numbers embedded in evidence ids as user claims', () => {
    const texts = collectUserFacingStrings({
      summary: '本次记录可能不完整',
      observations: [{
        text: '请检查训练时长',
        signal_key: 'training.session_duration',
        evidence_ref_ids: ['E-SESSION-001'],
      }],
    })

    expect(texts).toEqual(['本次记录可能不完整', '请检查训练时长'])
  })

  it('rejects a judgement backed only by arbitrary free-form authority text', () => {
    expect(findUnboundSignals([signal({ authority: 'someone said so' })])).toHaveLength(1)
  })

  it('accepts governed Patch authority or a real registry reference', () => {
    expect(findUnboundSignals([signal()])).toEqual([])
    expect(findUnboundSignals([
      signal({ authority: '', evidence_ref_ids: ['E-SESSION-001'] }),
    ])).toEqual([])
  })

  it('rejects a non-existent evidence reference', () => {
    expect(findUnboundSignals([
      signal({ evidence_ref_ids: ['E-NOT-REAL'] }),
    ])).toHaveLength(1)
  })
})
