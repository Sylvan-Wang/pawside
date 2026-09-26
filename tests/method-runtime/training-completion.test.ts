import { describe, expect, it } from 'vitest'
import { completionCountUnit, prescribedSetsAreComplete } from '../../lib/training-completion'

describe('training completion truth', () => {
  it('never treats an exercise with no prescribed sets as completed', () => {
    expect(prescribedSetsAreComplete([], () => true, () => true)).toBe(false)
    expect(prescribedSetsAreComplete(
      [{ isExtra: true, completed: true }],
      (set) => !set.isExtra,
      (set) => set.completed,
    )).toBe(false)
  })

  it('requires every original prescribed set but ignores extra sets', () => {
    const sets = [
      { isExtra: false, completed: true },
      { isExtra: false, completed: true },
      { isExtra: true, completed: false },
    ]
    expect(prescribedSetsAreComplete(sets, (set) => !set.isExtra, (set) => set.completed)).toBe(true)
    sets[1].completed = false
    expect(prescribedSetsAreComplete(sets, (set) => !set.isExtra, (set) => set.completed)).toBe(false)
  })

  it('uses set actuals only for legacy and non-advancing sessions', () => {
    expect(completionCountUnit({ executionMode: 'canonical', selectedSessionMinutes: 30, snapshotRequiredExerciseCount: 3 })).toBe('exercise')
    expect(completionCountUnit({ executionMode: 'canonical', selectedSessionMinutes: null, snapshotRequiredExerciseCount: null })).toBe('set')
    expect(completionCountUnit({ executionMode: 'supplemental', selectedSessionMinutes: 30, snapshotRequiredExerciseCount: 3 })).toBe('set')
  })
})
