import cases from '../../docs/method-import/fixtures/quantity-cases.json'
import { describe, expect, it } from 'vitest'
import { parseQuantities } from '../../lib/method-import/parse-quantities'

describe('method quantity parser', () => {
  for (const item of cases) {
    it(item.text, () => {
      const actual = parseQuantities(item.text) as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(item.expect)) expect(actual[key] ?? null).toEqual(value)
    })
  }

  it('keeps stepped, rest-pause and progression notation out of ordinary rep ranges', () => {
    expect(parseQuantities('正式组 12/10/8 次').sequenceReps).toEqual([12, 10, 8])
    expect(parseQuantities('做 10+10 次').restPauseReps).toEqual([10, 10])
    expect(parseQuantities('每周增加 5%-10%').progressionPercent).toEqual({ min: 5, max: 10 })
  })

  it('supports common English table-style notation', () => {
    const parsed = parseQuantities('Squat 4 sets x 8-10 reps, rest 90s')
    expect(parsed.reps).toEqual({ min: 8, max: 10 })
    expect(parsed.restSeconds).toEqual({ min: 90, max: 90 })
  })
})
