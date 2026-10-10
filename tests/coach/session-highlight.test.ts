import { describe, expect, it } from 'vitest'
import { computeSessionHighlight } from '@/lib/workout/session-highlight'

const base = { order: 1, status: 'completed', calibration: false }
const ex = (name: string, last: [number, number | null] | null, today: [number, number | null] | null, extra: Partial<typeof base> = {}) => ({
  ...base,
  ...extra,
  name,
  last_time: last ? { top_weight_kg: last[0], reps: last[1] } : null,
  top_today: today ? { top_weight_kg: today[0], reps: today[1] } : null,
})

describe('computeSessionHighlight', () => {
  it('returns null when there is nothing to compare with', () => {
    expect(computeSessionHighlight([])).toBeNull()
    expect(computeSessionHighlight([ex('卧推', null, [60, 8])])).toBeNull()
    expect(computeSessionHighlight([ex('卧推', [60, 8], null)])).toBeNull()
  })

  it('reports a heavier top set', () => {
    expect(computeSessionHighlight([ex('卧推', [60, 8], [62.5, 8])])).toEqual({
      kind: 'weight_up', exercise: '卧推', from_kg: 60, to_kg: 62.5,
    })
  })

  it('reports more reps at the same weight', () => {
    expect(computeSessionHighlight([ex('卧推', [60, 8], [60, 10])])).toEqual({
      kind: 'reps_up', exercise: '卧推', weight_kg: 60, from_reps: 8, to_reps: 10,
    })
  })

  it('prefers weight over reps, and the biggest weight gain across exercises', () => {
    const result = computeSessionHighlight([
      { ...ex('肩推', [20, 8], [20, 12]), order: 1 },
      { ...ex('卧推', [60, 8], [62.5, 8]), order: 2 },
      { ...ex('上斜', [40, 8], [45, 8]), order: 3 },
    ])
    expect(result).toEqual({ kind: 'weight_up', exercise: '上斜', from_kg: 40, to_kg: 45 })
  })

  it('breaks ties by exercise order', () => {
    const result = computeSessionHighlight([
      { ...ex('B', [20, 8], [22.5, 8]), order: 2 },
      { ...ex('A', [20, 8], [22.5, 8]), order: 1 },
    ])
    expect(result).toMatchObject({ exercise: 'A' })
  })

  it('never counts calibration or skipped exercises, or a lower weight', () => {
    expect(computeSessionHighlight([ex('卧推', [60, 8], [70, 8], { calibration: true })])).toBeNull()
    expect(computeSessionHighlight([ex('卧推', [60, 8], [70, 8], { status: 'skipped' })])).toBeNull()
    expect(computeSessionHighlight([ex('卧推', [60, 8], [55, 12])])).toBeNull()
  })

  it('needs reps on both sides to compare reps', () => {
    expect(computeSessionHighlight([ex('卧推', [60, null], [60, 10])])).toBeNull()
  })
})
