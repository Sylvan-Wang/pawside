/**
 * Pawside Coach — server-side switches for the 2026-09-27 coach patch.
 *
 * Every behaviour change in this patch sits behind one of these flags so it can
 * be turned off from the Netlify environment without a redeploy of code. All
 * flags default to ON; set the variable to `0` or `false` to disable.
 *
 * Why flags at all: parts of this patch are built on data we verified from
 * exports (DSH REAL_DATA_VERIFICATION_REPORT), not on a live database read.
 * If a live row turns out to differ, the affected piece can be switched off
 * while the rest keeps working.
 */

export type CoachFlag =
  /** New Chinese instructions for workout / meal / daily surfaces. */
  | 'COACH_PROMPT_V2'
  /** Load Method prescription vs actual + next-session key sets for workout feedback. */
  | 'COACH_METHOD_CONTEXT'
  /** Aggregate every save of the same meal (date + meal_type) for meal feedback. */
  | 'COACH_MEAL_CONTEXT'
  /** Reject model output that leaks internal terms, and retry once. */
  | 'COACH_OUTPUT_GUARD'

export function coachFlag(name: CoachFlag): boolean {
  const raw = process.env[`PAWSIDE_${name}`]
  if (raw === undefined) return true
  const value = raw.trim().toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}

/**
 * Duration basis (undecided product question, see docs/COACH_AI_PATCH_2026-09-27.md §2).
 *
 * - `set_span` (default): first completed set → last completed set.
 * - `session_span`: tapped start → tapped finish (the previous behaviour).
 */
export type DurationBasis = 'set_span' | 'session_span'

export function coachDurationBasis(): DurationBasis {
  return process.env.PAWSIDE_COACH_DURATION_BASIS?.trim() === 'session_span'
    ? 'session_span'
    : 'set_span'
}
