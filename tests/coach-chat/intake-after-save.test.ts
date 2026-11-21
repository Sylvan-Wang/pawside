import { describe, expect, it } from 'vitest'
import { intakeAfterSaveText } from '../../lib/coach-chat/replies'
import type { DayFacts } from '../../lib/coach-chat/day-facts'

const n = (over: Partial<DayFacts['nutrition']>) => ({
  target_kcal: 2000, known_kcal: 800, complete: true, unknown_item_count: 0, remaining_kcal: 1200,
  known_protein_g: null,
  targets: { calories_kcal: 2000, protein_g: null, carbs_g: null, fat_g: null },
  ...over,
}) as DayFacts['nutrition']

const withProtein = (target: number, known: number | null, over: Partial<DayFacts['nutrition']> = {}) => n({
  known_protein_g: known,
  targets: { calories_kcal: 2000, protein_g: target, carbs_g: null, fat_g: null },
  ...over,
})

describe('intake line after a meal is saved', () => {
  it('says how far the day is from the target', () => {
    expect(intakeAfterSaveText(n({}))).toContain('还差 1200 kcal')
    expect(intakeAfterSaveText(n({ known_kcal: 2300, remaining_kcal: -300 }))).toContain('多 300 kcal')
  })
  it('stays silent when the day cannot be totalled', () => {
    expect(intakeAfterSaveText(n({ complete: false }))).toBeNull()
    expect(intakeAfterSaveText(n({ known_kcal: null }))).toBeNull()
  })
  it('gives the total without a target', () => {
    expect(intakeAfterSaveText(n({ target_kcal: null, remaining_kcal: null }))).toBe('这一天已记约 800 kcal。')
  })
})

describe('±10% counts as on target', () => {
  it('does not report small leftovers either way', () => {
    for (const known of [1800, 1950, 2000, 2150, 2200]) {
      const text = intakeAfterSaveText(n({ known_kcal: known, remaining_kcal: 2000 - known })) as string
      expect(text).toContain('算到位了')
      expect(text).not.toMatch(/还差 \d|多 \d/)
    }
  })
  it('still reports a real gap just outside the band', () => {
    expect(intakeAfterSaveText(n({ known_kcal: 1790, remaining_kcal: 210 }))).toContain('还差 210 kcal')
    expect(intakeAfterSaveText(n({ known_kcal: 2210, remaining_kcal: -210 }))).toContain('多 210 kcal')
  })
})

describe('protein gap in palms', () => {
  it('says the gap in hand portions', () => {
    expect(intakeAfterSaveText(withProtein(120, 95))).toContain('蛋白质还差约 25g，大约一掌心瘦肉。')
    expect(intakeAfterSaveText(withProtein(120, 82))).toContain('大约一掌心半瘦肉')
    expect(intakeAfterSaveText(withProtein(120, 70))).toContain('大约两掌心瘦肉')
    expect(intakeAfterSaveText(withProtein(120, 20))).toContain('可以分到接下来几顿')
  })
  it('stays quiet for small gaps, unknown protein, or no protein target', () => {
    expect(intakeAfterSaveText(withProtein(120, 110))).not.toContain('蛋白质')
    expect(intakeAfterSaveText(withProtein(120, null))).not.toContain('蛋白质')
    expect(intakeAfterSaveText(n({ known_protein_g: 40 }))).not.toContain('蛋白质')
  })
  it('does not push more food once calories are clearly over', () => {
    expect(intakeAfterSaveText(withProtein(120, 60, { known_kcal: 2400, remaining_kcal: -400 }))).not.toContain('蛋白质')
  })
})
