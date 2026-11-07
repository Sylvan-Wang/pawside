import { describe, expect, it } from 'vitest'
import { normalizePlan } from '../../lib/coach-chat/schemas'
import { rawPlan, rawTask } from './helpers'

const kindFor = (value: number, unit: 'kg' | 'lb' | 'jin' | null) =>
  normalizePlan(rawPlan([rawTask('log_weight', { weight_value: value, weight_unit: unit })])).tasks[0].kind

describe('body weight plausibility', () => {
  it('keeps real weights in any unit', () => {
    expect(kindFor(68.5, 'kg')).toBe('log_weight')
    expect(kindFor(130, 'jin')).toBe('log_weight')
    expect(kindFor(160, 'lb')).toBe('log_weight')
    expect(kindFor(130, null)).toBe('log_weight')
  })
  it('turns impossible weights into a re-ask instead of a record', () => {
    expect(kindFor(500, 'kg')).toBe('invalid')
    expect(kindFor(5, 'kg')).toBe('invalid')
    expect(kindFor(900, null)).toBe('invalid')
  })
})
