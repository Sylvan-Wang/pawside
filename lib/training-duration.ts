export const SESSION_MINUTE_OPTIONS = [30, 45, 60, 90] as const

export type SessionMinutes = (typeof SESSION_MINUTE_OPTIONS)[number]
export type SessionMinuteSelectionSource =
  | 'profile_default'
  | 'user_override'
  | 'mid_session_change'

export function isSessionMinutes(value: unknown): value is SessionMinutes {
  return typeof value === 'number' && SESSION_MINUTE_OPTIONS.includes(value as SessionMinutes)
}

export function requiredExerciseCount(totalExerciseCount: number, selectedSessionMinutes: SessionMinutes) {
  if (!Number.isInteger(totalExerciseCount) || totalExerciseCount < 0) {
    throw new RangeError('totalExerciseCount must be a non-negative integer')
  }

  return Math.min(
    totalExerciseCount,
    Math.ceil(totalExerciseCount * selectedSessionMinutes / 60),
  )
}

export type TrainingExecutionMode = 'canonical' | 'replay' | 'supplemental'

/**
 * The exercise-count threshold that gates THIS session.
 *
 * Mirrors public.complete_method_session_v2 exactly.
 *
 * - A `canonical` session completes the Program Day, so the Minimum P1
 *   `required_exercise_count` snapshot applies.
 * - `replay` and `supplemental` sessions never complete or advance a Program Day
 *   (PRD §11.2, §12). The Minimum P1 PRD does not define a threshold for them, so
 *   instead of inventing one they keep the released "at least one" floor. That is
 *   what stops a supplemental session ("came back for the exercises I skipped")
 *   from becoming an un-completable active session.
 * - A session started before Minimum P1 carries no snapshot and also keeps the
 *   floor, so in-flight sessions are never retroactively made stricter.
 */
export function effectiveRequiredExerciseCount(input: {
  executionMode?: string | null
  originalExerciseCount: number
  snapshotRequiredExerciseCount?: number | null
  selectedSessionMinutes?: number | null
}) {
  const total = input.originalExerciseCount
  const floor = Math.min(1, total)

  if (input.executionMode === 'replay' || input.executionMode === 'supplemental') return floor
  if (input.snapshotRequiredExerciseCount != null) {
    return Math.min(input.snapshotRequiredExerciseCount, total)
  }
  if (input.selectedSessionMinutes != null) {
    return requiredExerciseCount(total, input.selectedSessionMinutes as SessionMinutes)
  }
  return floor
}
