import { TOUR_STEPS, TOUR_VERSION, type TourStep } from './steps'

/**
 * Who sees the tour, and when (xxa, 2026-11-21: it kept popping up for people who
 * are not new).
 *
 * - The full tour is only for new accounts: never seen it AND signed up within
 *   NEW_USER_DAYS. An older account that has no record of seeing it (cleared
 *   storage, new phone, Safari wiping site data) is treated as having seen it.
 * - "What's new" steps are shown only on the day the feature launched
 *   (`launchedOn`, in the user's own time zone). Missing that day means missing
 *   the popup; the steps are still in Settings → 重看导览.
 * - What was seen is the newer of the account record (user_metadata, follows the
 *   person across devices) and this browser's localStorage.
 *
 * Whenever the result shows nothing but `seen` is behind TOUR_VERSION, the caller
 * should record TOUR_VERSION as seen so the decision is not re-made every visit.
 */
export const NEW_USER_DAYS = 3

export type TourDecision = {
  steps: TourStep[]
  returning: boolean
  /** True when the caller should record TOUR_VERSION as seen without showing anything. */
  markSeenSilently: boolean
}

export function seenVersionFrom(local: number | null, account: unknown): number | null {
  const fromAccount = typeof account === 'number' && Number.isInteger(account) && account >= 0 ? account : null
  if (local === null) return fromAccount
  if (fromAccount === null) return local
  return Math.max(local, fromAccount)
}

/** YYYY-MM-DD of `now` in the given IANA time zone (falls back to UTC). */
export function localDateKey(now: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export function decideTour(input: {
  seen: number | null
  accountCreatedAt: string | null
  now: Date
  timeZone?: string
  steps?: TourStep[]
  version?: number
}): TourDecision {
  const steps = input.steps ?? TOUR_STEPS
  const version = input.version ?? TOUR_VERSION
  const none = (markSeenSilently: boolean): TourDecision => ({ steps: [], returning: false, markSeenSilently })

  if (input.seen !== null && input.seen >= version) return none(false)

  if (input.seen === null) {
    const created = input.accountCreatedAt ? Date.parse(input.accountCreatedAt) : NaN
    // Unknown signup time: do not guess "new" — showing nothing is the cheaper mistake.
    if (!Number.isFinite(created)) return none(true)
    const ageDays = (input.now.getTime() - created) / 86_400_000
    if (ageDays > NEW_USER_DAYS) return none(true)
    return { steps, returning: false, markSeenSilently: false }
  }

  const today = localDateKey(input.now, input.timeZone)
  const fresh = steps.filter((step) => step.since > input.seen! && step.launchedOn === today)
  if (fresh.length === 0) return none(true)
  return { steps: fresh, returning: true, markSeenSilently: false }
}
