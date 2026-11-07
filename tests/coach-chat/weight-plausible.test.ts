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

describe('typical serving when the model gave no grams', () => {
  const item = (unit: string, dish: 'mixed_dish' | 'drink' | 'single') =>
    normalizePlan(rawPlan([rawTask('log_meal', { items: [{ name: 'x', amount_value: 1, amount_unit: unit, grams_estimate: null, estimate_basis: 'unknown', dish_kind: dish }] })])).tasks[0]
  it('fills a whole dish and a drink as an estimate', () => {
    expect(item('份', 'mixed_dish')).toMatchObject({ items: [{ grams: 400, gramsBasis: 'model_estimate' }] })
    expect(item('罐', 'drink')).toMatchObject({ items: [{ grams: 330, gramsBasis: 'model_estimate' }] })
  })
  it('leaves single foods alone', () => {
    expect(item('个', 'single')).toMatchObject({ items: [{ grams: null }] })
  })
})
