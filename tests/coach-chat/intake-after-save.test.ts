import { describe, expect, it } from 'vitest'
import { intakeAfterSaveText } from '../../lib/coach-chat/replies'
import type { DayFacts } from '../../lib/coach-chat/day-facts'

const n = (over: Partial<DayFacts['nutrition']>) => ({
  target_kcal: 2000, known_kcal: 800, complete: true, unknown_item_count: 0, remaining_kcal: 1200, ...over,
}) as DayFacts['nutrition']

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
