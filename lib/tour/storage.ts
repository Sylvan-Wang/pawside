import { TOUR_VERSION } from './steps'

/**
 * Which tour version this browser has seen. Kept in localStorage on purpose: it
 * needs no schema change, so it can ship ahead of any database migration. The
 * cost is that it is per device. Every access is guarded — storage can throw in
 * private windows — and a failure just means the tour is not shown.
 */
const KEY = 'pawside.tour.seen'

export function readSeenVersion(): number | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isInteger(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

export function markTourSeen(version = TOUR_VERSION) {
  try {
    window.localStorage.setItem(KEY, String(version))
  } catch {
    // ignore: worst case the tour shows once more
  }
}

export function resetTourSeen() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
