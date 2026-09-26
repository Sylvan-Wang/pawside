export type CompletionCountUnit = 'exercise' | 'set'

export function prescribedSetsAreComplete<T>(
  sets: readonly T[],
  isPrescribed: (set: T) => boolean,
  isCompleted: (set: T) => boolean,
) {
  const prescribed = sets.filter(isPrescribed)
  return prescribed.length > 0 && prescribed.every(isCompleted)
}

export function completionCountUnit(input: {
  executionMode?: string | null
  selectedSessionMinutes?: number | null
  snapshotRequiredExerciseCount?: number | null
}): CompletionCountUnit {
  if (input.executionMode === 'replay' || input.executionMode === 'supplemental') return 'set'
  if (input.selectedSessionMinutes == null && input.snapshotRequiredExerciseCount == null) return 'set'
  return 'exercise'
}
