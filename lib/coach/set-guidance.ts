/**
 * Pawside Coach — per-set Method guidance.
 *
 * `set_prescriptions` already carries set_type, rep targets, failure flags and a
 * quality note for every planned set (20260912000100_method_runtime_set_templates.sql),
 * but the training page rendered every set identically. This module turns a
 * planned set into short user-facing labels, and derives the "key sets" of a
 * session for the workout feedback prompt.
 *
 * Uncertainty handling:
 * - Numeric targets (target_rpe / target_rir / target_weight_kg / rest) were null
 *   in the verified export. Every field is optional here; a missing value simply
 *   produces no text rather than a guessed default.
 * - Some quality notes are internal provenance ("运行时默认；不得表述为作者原始处方").
 *   Those segments are stripped; only the user-meaningful part ("每侧") is kept.
 */

export type SetType = 'warmup' | 'working' | 'failure' | 'rest_pause' | 'backoff' | 'other'

export interface PlannedSetInput {
  set_index: number
  set_type?: string | null
  target_reps_min?: number | null
  target_reps_max?: number | null
  target_rpe?: number | null
  target_rir?: number | null
  failure_allowed?: boolean | null
  failure_required?: boolean | null
  target_weight_kg?: number | null
  rest_min_seconds?: number | null
  rest_max_seconds?: number | null
  quality_requirement?: string | null
}

export interface PlannedSetGuidance {
  /** e.g. 热身组 / 正式组 / 力竭组 / 递减组 / 休息-暂停组 */
  label: string
  /** e.g. "12 次", "8–12 次", "10 + 5 次". null when the plan has no rep target. */
  target: string | null
  /** e.g. "不做到力竭", "做到接近力竭", "保留 2 次余力". */
  effort: string | null
  /** User-meaningful part of the quality note, e.g. "每侧", "组内休息 5 秒". */
  note: string | null
  /** True for sets the Method treats as the key effort of the exercise. */
  emphasis: boolean
}

const SET_TYPE_LABELS: Record<string, string> = {
  warmup: '热身组',
  working: '正式组',
  failure: '力竭组',
  rest_pause: '休息-暂停组',
  backoff: '递减组',
  other: '本组',
}

const INTERNAL_NOTE = /运行时默认|不得表述|作者原始处方|product_execution_default|method_explicit/
/** Notes that only repeat the label ("热身组", "正式组 2") add nothing. */
const REDUNDANT_NOTE = /^(热身组|正式组|力竭组)\s*\d*$/

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Keeps only the user-facing segments of a quality note. */
export function userFacingNote(note: string | null | undefined): string | null {
  if (!note) return null
  const segments = note
    .split(/[；;]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !INTERNAL_NOTE.test(segment) && !REDUNDANT_NOTE.test(segment))
  return segments.length > 0 ? segments.join('；') : null
}

/** "10 + 5" style two-segment reps written in the quality note, if any. */
export function segmentedReps(note: string | null | undefined): [number, number] | null {
  if (!note) return null
  const match = note.match(/(\d+)\s*[+＋]\s*(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

function repsText(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  if (min !== null && max !== null && min !== max) return `${min}–${max} 次`
  return `${min ?? max} 次`
}

export function describePlannedSet(set: PlannedSetInput): PlannedSetGuidance {
  const type = set.set_type ?? 'working'
  const segments = segmentedReps(set.quality_requirement)
  const min = toNumber(set.target_reps_min)
  const max = toNumber(set.target_reps_max)
  const rir = toNumber(set.target_rir)
  const rpe = toNumber(set.target_rpe)

  const target = segments ? `${segments[0]} + ${segments[1]} 次` : repsText(min, max)

  let effort: string | null = null
  if (set.failure_required) effort = '做到力竭'
  else if (rir !== null) effort = `保留 ${rir} 次余力`
  else if (rpe !== null) effort = `RPE ${rpe}`
  else if (set.failure_allowed) effort = type === 'rest_pause' || type === 'failure' ? '做到接近或到力竭' : '可以接近力竭'
  else if (type === 'warmup') effort = '轻松完成'
  else if (type === 'working') effort = '不做到力竭'

  // Segment reps are already in `target`; keep the rest of the note (e.g. rest time).
  let note = userFacingNote(set.quality_requirement)
  if (note && segments) {
    note = note
      .split('；')
      .filter((segment) => !/\d+\s*[+＋]\s*\d+/.test(segment))
      .join('；') || null
  }

  return {
    label: SET_TYPE_LABELS[type] ?? SET_TYPE_LABELS.other,
    target,
    effort,
    note,
    emphasis: type === 'failure' || type === 'rest_pause' || set.failure_required === true,
  }
}

export interface PlannedExerciseInput {
  exercise_name: string
  sets: PlannedSetInput[]
  /** exercise_prescriptions.weight_guidance_type */
  weight_guidance_type?: string | null
}

export interface KeySetHint {
  exercise_name: string
  set_index: number
  text: string
}

/**
 * Key sets of a (next) session, derived only from the plan. The prompt may
 * paraphrase these, but never add a weight or a rep count that is not here.
 * Calibration exercises are excluded: their job is finding a weight, not
 * pushing a set.
 */
export function buildKeySetHints(exercises: PlannedExerciseInput[], limit = 3): KeySetHint[] {
  const hints: KeySetHint[] = []
  for (const exercise of exercises) {
    if (exercise.weight_guidance_type === 'calibration') continue
    for (const set of [...exercise.sets].sort((a, b) => a.set_index - b.set_index)) {
      const guidance = describePlannedSet(set)
      if (!guidance.emphasis) continue
      const parts = [guidance.target, guidance.effort, guidance.note].filter(Boolean)
      hints.push({
        exercise_name: exercise.exercise_name,
        set_index: set.set_index,
        text: `${exercise.exercise_name} 第 ${set.set_index} 组（${guidance.label}）：${parts.join('，')}`,
      })
      if (hints.length >= limit) return hints
    }
  }
  return hints
}

/** Every number a hint or plan text may legitimately contain, for the numeric-integrity gate. */
export function planNumbers(exercises: PlannedExerciseInput[]): number[] {
  const numbers = new Set<number>()
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      numbers.add(set.set_index)
      for (const value of [
        set.target_reps_min, set.target_reps_max, set.target_rir, set.target_rpe,
        set.target_weight_kg, set.rest_min_seconds, set.rest_max_seconds,
      ]) {
        const numeric = toNumber(value)
        if (numeric !== null) numbers.add(numeric)
      }
      for (const token of set.quality_requirement?.match(/\d+(?:\.\d+)?/g) ?? []) numbers.add(Number(token))
    }
  }
  return [...numbers]
}
