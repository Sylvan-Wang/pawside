/**
 * Pawside Coach — how long a session "really" took.
 *
 * Proposed definition (flag PAWSIDE_COACH_DURATION_BASIS, default `set_span`):
 * first completed set → last completed set. Tapping "finish" late, or entering
 * sets later in a batch, then no longer distorts the number.
 *
 * Fallbacks, in order: session span (started_at → completed_at), then the
 * stored minutes. Whatever the basis, a value outside 5–150 minutes is marked
 * `excluded`: it is kept for display as a recording issue but never handed to
 * the model as a training fact (Method M008: duration is not judged).
 */

import type { DurationBasis } from './flags'

export const DURATION_MIN_MINUTES = 5
export const DURATION_MAX_MINUTES = 150

export interface EffectiveDuration {
  /** Minutes the model and rules may use. null when excluded or unknown. */
  minutes: number | null
  /** Raw minutes before exclusion, for display/diagnostics. */
  raw_minutes: number | null
  basis: 'set_span' | 'session_span' | 'stored' | 'none'
  excluded: boolean
}

function toTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function minutesBetween(from: number, to: number): number | null {
  if (to < from) return null
  return Math.max(1, Math.round((to - from) / 60000))
}

export function withinDurationRange(minutes: number | null): boolean {
  return minutes !== null && minutes >= DURATION_MIN_MINUTES && minutes <= DURATION_MAX_MINUTES
}

export function computeEffectiveDuration(input: {
  basis: DurationBasis
  startedAt?: string | null
  completedAt?: string | null
  setCompletedAts?: Array<string | null | undefined>
  storedMinutes?: number | null
}): EffectiveDuration {
  const setTimes = (input.setCompletedAts ?? [])
    .map(toTime)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)

  let raw: number | null = null
  let basis: EffectiveDuration['basis'] = 'none'

  if (input.basis === 'set_span' && setTimes.length >= 2) {
    raw = minutesBetween(setTimes[0], setTimes[setTimes.length - 1])
    if (raw !== null) basis = 'set_span'
  }

  if (raw === null) {
    const started = toTime(input.startedAt)
    const completed = toTime(input.completedAt)
    if (started !== null && completed !== null) {
      raw = minutesBetween(started, completed)
      if (raw !== null) basis = 'session_span'
    }
  }

  if (raw === null && input.storedMinutes !== null && input.storedMinutes !== undefined
    && Number.isFinite(input.storedMinutes)) {
    raw = Number(input.storedMinutes)
    basis = 'stored'
  }

  const excluded = raw !== null && !withinDurationRange(raw)
  return {
    minutes: raw !== null && !excluded ? raw : null,
    raw_minutes: raw,
    basis,
    excluded,
  }
}

/** Stored minutes only (daily review has no set timestamps): same 5–150 gate. */
export function sanitizeStoredDuration(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null
  return withinDurationRange(minutes) ? minutes : null
}

/**
 * Daily total from stored per-session minutes. Each session is gated on its
 * own, so two normal sessions (90 + 80) are not excluded as one 170-minute
 * "outlier", and one broken session does not hide a normal one.
 *
 * - no sessions → 0 (a rest day is a fact, not missing data)
 * - some usable → sum of the usable ones
 * - none usable → null
 */
export function sanitizeDailyDuration(sessionMinutes: Array<number | null | undefined>): {
  minutes: number | null
  excluded_count: number
} {
  if (sessionMinutes.length === 0) return { minutes: 0, excluded_count: 0 }
  let total = 0
  let usable = 0
  let excluded = 0
  for (const value of sessionMinutes) {
    const clean = sanitizeStoredDuration(value)
    if (clean === null) {
      if (value !== null && value !== undefined && Number.isFinite(value)) excluded += 1
      continue
    }
    total += clean
    usable += 1
  }
  return { minutes: usable > 0 ? total : null, excluded_count: excluded }
}
