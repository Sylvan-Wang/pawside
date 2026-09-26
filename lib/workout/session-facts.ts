/**
 * Pawside — Workout session facts (deterministic).
 *
 * Authority:
 *   Product §13 Layer A — Session Facts: only what the database really holds
 *   Product §13 Layer B — Computed Signals: only what a rule can determine
 *   AI Patch §8        — session duration is NOT a health judgement; the
 *                        very_short / very_long flags are data quality only
 *   AI Patch §25.1     — the AI receives facts + signals, never raw logs
 *   Guardrail §12      — "0 sets" must be distinguishable from "not recorded"
 *
 * Two persisted shapes must both be understood, because both are real:
 *   Method session (from complete_method_session_v2,
 *     20260925000500_training_runtime_truth_hardening.sql:446-467):
 *       { name, status, sets: [{ set, weight_kg, reps, rir, extra }] }
 *   Free workout (app/workout/page.tsx):
 *       { name, sets: number, reps: string, weight: number }
 *
 * Nothing here may be inferred from a missing field: an absent value stays
 * "unknown" so a recap never presents invented numbers (Product §13 Layer A).
 */

export interface SessionSetFact {
  set_index: number
  weight_kg: number | null
  reps: number | null
  rir: number | null
  is_extra: boolean
}

export interface SessionExerciseFact {
  name: string
  status: string | null
  /** null = the log did not record sets as a list (free-workout shape). */
  sets: SessionSetFact[] | null
  /** Free-workout scalar group count, when present. */
  reported_set_count: number | null
  /** Free-workout rep expression, e.g. "8-10" — kept as text, not parsed. */
  reported_reps: string | null
}

export type RecordCompleteness = 'none' | 'name_only' | 'partial' | 'full' | 'unknown'

export interface SessionFacts {
  exercise_count: number
  completed_exercise_count: number
  /** Sum of completed set rows across all exercises. null when not recorded. */
  completed_set_count: number | null
  total_volume_kg: number | null
  duration_minutes: number | null
  record_completeness: RecordCompleteness
  data_quality_flags: string[]
  exercises: SessionExerciseFact[]
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSet(raw: Record<string, unknown>, index: number): SessionSetFact {
  return {
    set_index: toNumber(raw.set ?? raw.set_index ?? raw.setIndex) ?? index + 1,
    weight_kg: toNumber(raw.weight_kg ?? raw.weightKg ?? raw.weight),
    reps: toNumber(raw.reps),
    rir: toNumber(raw.rir),
    is_extra: raw.extra === true || raw.is_extra === true,
  }
}

/**
 * Parses the persisted `workout_logs.exercises` JSON. Unknown shapes degrade to
 * an entry with `sets: null` rather than being dropped or guessed at.
 */
export function parseSessionExercises(exercises: unknown): SessionExerciseFact[] {
  if (!Array.isArray(exercises)) return []

  return exercises.flatMap((value): SessionExerciseFact[] => {
    if (!value || typeof value !== 'object') return []
    const raw = value as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) return []

    const rawSets = raw.sets

    // Method shape: sets is an array of completed set rows.
    if (Array.isArray(rawSets)) {
      return [{
        name,
        status: typeof raw.status === 'string' ? raw.status : null,
        sets: rawSets.flatMap((setValue, index): SessionSetFact[] => {
          if (!setValue || typeof setValue !== 'object') return []
          return [normalizeSet(setValue as Record<string, unknown>, index)]
        }),
        reported_set_count: null,
        reported_reps: null,
      }]
    }

    // Free-workout shape: sets is a scalar count, reps is free text.
    return [{
      name,
      status: typeof raw.status === 'string' ? raw.status : null,
      sets: null,
      reported_set_count: toNumber(rawSets),
      reported_reps: typeof raw.reps === 'string' ? raw.reps : null,
    }]
  })
}

/**
 * Product §13 Layer A + Layer B.
 *
 * `record_completeness` follows the same vocabulary as
 * `lib/ai-rules.ts#evaluateExerciseCompleteness` so the session recap and the
 * daily review describe record quality identically.
 */
export function computeSessionFacts(input: {
  exercises: unknown
  durationMinutes: number | null
  type?: string | null
}): SessionFacts {
  const exercises = parseSessionExercises(input.exercises)
  const dataQualityFlags: string[] = []

  // An exercise whose `sets` is an empty array was recorded but not performed
  // (e.g. the Method marks it `skipped`). That is real information, not a
  // missing record, so it must not drag completeness down the way the
  // free-workout shape does — there, set-level detail genuinely never existed.
  const exercisesWithSets = exercises.filter(
    (exercise) => exercise.sets !== null && exercise.sets.length > 0,
  )
  let completedSetCount: number | null = null
  let totalVolume: number | null = null

  if (exercisesWithSets.length > 0) {
    completedSetCount = 0
    totalVolume = 0
    let volumeComputable = false

    for (const exercise of exercisesWithSets) {
      for (const set of exercise.sets ?? []) {
        completedSetCount += 1
        if (set.weight_kg !== null && set.reps !== null) {
          totalVolume += set.weight_kg * set.reps
          volumeComputable = true
        }
      }
    }
    // Volume stays null when no set carried both weight and reps, so the recap
    // does not render a confident 0 kg (Product §13 Layer A).
    if (!volumeComputable) totalVolume = null
  } else {
    const scalarCounts = exercises
      .map((exercise) => exercise.reported_set_count)
      .filter((value): value is number => value !== null)
    if (scalarCounts.length > 0) {
      completedSetCount = scalarCounts.reduce((a, b) => a + b, 0)
    }
    dataQualityFlags.push('set_level_detail_missing')
  }

  const completedExerciseCount = exercises.filter((exercise) => {
    if (exercise.sets !== null) {
      // Set-level record: completed when any non-extra set exists. A skipped
      // exercise legitimately has zero completed sets.
      return exercise.sets.some((set) => !set.is_extra)
    }
    return exercise.status === 'completed'
  }).length

  const completeness = evaluateRecordCompleteness(exercises)

  const duration = input.durationMinutes
  // AI Patch §8: duration flags are data-quality signals only, never a health
  // judgement. Wording must stay "record looks unusual", not "over-training".
  if (duration !== null) {
    if (duration < 1) dataQualityFlags.push('duration_missing_or_zero')
    else if (duration < 5) dataQualityFlags.push('duration_unusually_short')
    else if (duration > 150) dataQualityFlags.push('duration_unusually_long')
  }

  if (completeness === 'name_only') dataQualityFlags.push('exercise_detail_incomplete')

  return {
    exercise_count: exercises.length,
    completed_exercise_count: completedExerciseCount,
    completed_set_count: completedSetCount,
    total_volume_kg: totalVolume,
    duration_minutes: duration,
    record_completeness: completeness,
    data_quality_flags: dataQualityFlags,
    exercises,
  }
}

/**
 * Mirrors `lib/ai-rules.ts#evaluateExerciseCompleteness`, extended with
 * `unknown` for the case where exercises exist but carry no detail at all.
 *
 * An exercise the user SKIPPED is excluded from coverage: it legitimately has
 * no weight/reps, so penalising completeness for it would report a data-quality
 * problem that does not exist (and would contradict Product §13 Layer B, which
 * only permits signals a rule can actually determine).
 */
export function evaluateRecordCompleteness(exercises: SessionExerciseFact[]): RecordCompleteness {
  if (exercises.length === 0) return 'none'

  const performed = exercises.filter((exercise) => exercise.status !== 'skipped')
  const considered = performed.length > 0 ? performed : exercises

  // Only exercises that actually carry set rows count as set-level detail.
  const withSets = considered.filter(
    (exercise) => exercise.sets !== null && exercise.sets.length > 0,
  )
  if (withSets.length === 0) {
    // Free-workout rows only ever carry a group count, so "partial" is the
    // honest ceiling for that shape.
    const anyScalar = considered.some((exercise) => exercise.reported_set_count !== null)
    return anyScalar ? 'partial' : 'name_only'
  }

  const allFull = withSets.every((exercise) =>
    (exercise.sets ?? []).every((set) => set.weight_kg !== null && set.reps !== null),
  )
  if (allFull && withSets.length === considered.length) return 'full'

  return 'partial'
}

/**
 * Product §13 Layer B: only signals a rule can determine, with provenance.
 * Returned as structured data so the UI can render a `?` explanation
 * (Product §25 / AC-P14) rather than an unsourced adjective.
 */
export interface ComputedSignal {
  signal_key: string
  status: 'within_reference' | 'below_reference' | 'above_reference' | 'caution' | 'insufficient_data' | 'not_assessable'
  text: string
  /** Patch section or evidence id. No threshold may appear without one. */
  authority: string
}

export function computeSessionSignals(facts: SessionFacts): ComputedSignal[] {
  const signals: ComputedSignal[] = []

  // Source: AI Patch §8 — no universal healthy duration exists; this is a
  // record-accuracy hint, phrased as such.
  if (facts.data_quality_flags.includes('duration_unusually_long')) {
    signals.push({
      signal_key: 'session_duration',
      status: 'caution',
      text: '本次记录时长明显长于常见单次训练，建议检查记录是否准确。',
      authority: 'AI Patch §8',
    })
  } else if (facts.data_quality_flags.includes('duration_unusually_short')) {
    signals.push({
      signal_key: 'session_duration',
      status: 'caution',
      text: '本次记录时长很短，如果漏记了时间可以补上。',
      authority: 'AI Patch §8',
    })
  }

  // Source: Product §13 Layer B — record completeness.
  if (facts.record_completeness === 'name_only' || facts.record_completeness === 'partial') {
    signals.push({
      signal_key: 'record_completeness',
      status: 'insufficient_data',
      text: '这次训练只记录了部分动作数据，补上组数或重量能让复盘更准确。',
      authority: 'Product Patch §13',
    })
  }

  return signals
}
