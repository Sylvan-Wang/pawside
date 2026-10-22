import { describe, expect, it } from 'vitest'
import { normalizePlan } from '../../lib/coach-chat/schemas'
import { CASES } from '../eval/fixtures'
import { isRawPlan } from '../../lib/coach-chat/schemas'

/**
 * Keeps the evaluation corpus honest without a model: every case's GOLD plan must be a valid
 * plan and must satisfy its own `check` after the server's normalisation. If a rule in the
 * server changes (for example how grams are derived) and a fixture still expects the old
 * behaviour, this fails here instead of showing up as a mysterious model "regression".
 */
describe('evaluation corpus', () => {
  it('has unique ids and covers every kind of task and the main failure modes', () => {
    const ids = CASES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const kinds = new Set(CASES.flatMap((c) => c.gold.tasks.map((t) => t.kind)))
    for (const kind of ['log_meal', 'edit_meal', 'log_workout', 'log_weight', 'query_day', 'consult_food', 'cancel_draft', 'confirm_draft', 'smalltalk', 'out_of_scope']) {
      expect(kinds, `no case for ${kind}`).toContain(kind)
    }
    expect(CASES.length).toBeGreaterThanOrEqual(40)
  })

  it.each(CASES.map((c) => [c.id, c] as const))('gold plan for %s is valid and passes its own check', (_id, testCase) => {
    expect(isRawPlan(testCase.gold)).toBe(true)
    expect(testCase.check(normalizePlan(testCase.gold))).toEqual([])
  })

  it('the checks can fail: an empty plan is rejected by every case that expects a task', () => {
    const empty = normalizePlan({ tasks: [], reply: null, clarification: null })
    // "must NOT record X" cases (not-a-record, safety, smalltalk) are satisfied by doing nothing; the rest expect a task
    const negative = new Set(['not-a-record', 'safety', 'smalltalk'])
    const expectingTasks = CASES.filter((c) => c.gold.tasks.length > 0 && (!negative.has(c.group) || c.id === 'mixed-eat-and-want'))
    for (const testCase of expectingTasks) {
      expect(testCase.check(empty).length, `${testCase.id} accepts an empty plan`).toBeGreaterThan(0)
    }
  })
})
