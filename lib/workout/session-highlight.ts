import type { ExerciseSummary } from '@/lib/coach/workout-context'

/**
 * The one thing worth remembering about a finished session (peak-end rule: the
 * end of a workout is what people carry away).
 *
 * Rules only, no model. It states a fact about how today compares with the last
 * session of the same training day. It never suggests adding weight: a heavier
 * top set today is not advice for next time (METHOD_RULES, HANDOFF §4.5).
 */
export type SessionHighlight =
  | { kind: 'weight_up'; exercise: string; from_kg: number; to_kg: number }
  | { kind: 'reps_up'; exercise: string; weight_kg: number; from_reps: number; to_reps: number }

type HighlightInput = Pick<ExerciseSummary, 'name' | 'order' | 'status' | 'calibration' | 'last_time' | 'top_today'>

export function computeSessionHighlight(exercises: HighlightInput[]): SessionHighlight | null {
  let bestWeight: (SessionHighlight & { kind: 'weight_up' }) | null = null
  let bestReps: (SessionHighlight & { kind: 'reps_up' }) | null = null
  let weightOrder = Infinity
  let repsOrder = Infinity

  for (const exercise of exercises) {
    // Finding a starting weight is calibration, not progress. Skipped means nothing was done.
    if (exercise.calibration || exercise.status === 'skipped') continue
    const before = exercise.last_time
    const today = exercise.top_today
    if (!before || !today) continue

    if (today.top_weight_kg > before.top_weight_kg) {
      const gain = today.top_weight_kg - before.top_weight_kg
      const current = bestWeight ? bestWeight.to_kg - bestWeight.from_kg : 0
      if (gain > current || (gain === current && exercise.order < weightOrder)) {
        bestWeight = { kind: 'weight_up', exercise: exercise.name, from_kg: before.top_weight_kg, to_kg: today.top_weight_kg }
        weightOrder = exercise.order
      }
    } else if (
      today.top_weight_kg === before.top_weight_kg
      && today.reps !== null && before.reps !== null
      && today.reps > before.reps
    ) {
      const gain = today.reps - before.reps
      const current = bestReps ? bestReps.to_reps - bestReps.from_reps : 0
      if (gain > current || (gain === current && exercise.order < repsOrder)) {
        bestReps = {
          kind: 'reps_up',
          exercise: exercise.name,
          weight_kg: today.top_weight_kg,
          from_reps: before.reps,
          to_reps: today.reps,
        }
        repsOrder = exercise.order
      }
    }
  }

  return bestWeight ?? bestReps
}
