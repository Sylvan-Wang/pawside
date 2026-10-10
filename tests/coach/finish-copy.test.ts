import { describe, expect, it } from 'vitest'
import { finishCopy, highlightCopy } from '@/lib/workout/finish-copy'

const done = { next_split_key: 'pull', current_cycle_number: 1, cycle_completed: false, progression_advanced: true, log_date: '2026-10-10' }

describe('finishCopy', () => {
  it('a plain finish says so and points at what is next', () => {
    expect(finishCopy(done, null, 'kg')).toMatchObject({ headline: '今天练完了', detail: null, celebrate: false })
    expect(finishCopy(done, null, 'kg').next).toContain('下一次')
  })

  it('leads with the highlight, in the unit the user trains in', () => {
    const h = { kind: 'weight_up' as const, exercise: '卧推', from_kg: 60, to_kg: 62.5 }
    expect(finishCopy(done, h, 'kg')).toMatchObject({ headline: '卧推比上次重了', detail: '60 → 62.5 kg' })
    expect(finishCopy(done, h, 'lb').detail).toMatch(/lb$/)
  })

  it('states a reps gain as a fact', () => {
    expect(highlightCopy({ kind: 'reps_up', exercise: '卧推', weight_kg: 60, from_reps: 8, to_reps: 10 }, 'kg')).toEqual({
      headline: '卧推同样的重量多做了 2 次',
      detail: '60 kg × 8 → 10 次',
    })
  })

  it('only a finished cycle is celebrated, and it counts the cycle that just ended', () => {
    const copy = finishCopy({ ...done, cycle_completed: true, current_cycle_number: 3 }, null, 'kg')
    expect(copy).toMatchObject({ headline: '第 2 轮练完了', celebrate: true })
  })

  it('a supplementary session is recorded without touching the plan, and is never celebrated', () => {
    const copy = finishCopy({ ...done, program_day_completed: false, progression_advanced: false, cycle_completed: true }, null, 'kg')
    expect(copy).toMatchObject({ celebrate: false })
    expect(copy.next).toContain('不影响')
  })

  it('with no completion payload it still ends gracefully', () => {
    expect(finishCopy(null, null, 'kg').next).toBe('这次的记录已经保存。')
  })
})
