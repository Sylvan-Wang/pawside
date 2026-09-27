/**
 * Pawside — unsaved meal-entry drafts (Patch B · B1).
 *
 * Same approach as `lib/training-draft-store.ts`: food rows typed into the
 * entry panel but not yet saved used to vanish when the user navigated away
 * or the panel was closed. They are now kept in localStorage per
 * user + date + meal_type, and restored when that meal's panel is reopened.
 *
 * Deliberately NOT an auto-save to the server: saving is still an explicit
 * "保存" action. This only keeps what was typed on this device. Drafts older
 * than 48 hours are ignored.
 */

const STORAGE_KEY = 'pawside-food-unsaved-drafts-v1'
const MAX_AGE_MS = 48 * 60 * 60 * 1000

interface StoredMealDraft {
  items: unknown[]
  updatedAt: string
}

type DraftMap = Record<string, StoredMealDraft>

function draftKey(userId: string, date: string, mealType: string) {
  return [userId, date, mealType].join(':')
}

function readAll(): DraftMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const now = Date.now()
    const fresh: DraftMap = {}
    for (const [key, value] of Object.entries(parsed as DraftMap)) {
      const time = Date.parse(value?.updatedAt ?? '')
      if (Number.isFinite(time) && now - time <= MAX_AGE_MS && Array.isArray(value?.items)) fresh[key] = value
    }
    return fresh
  } catch {
    return {}
  }
}

function writeAll(map: DraftMap) {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(map).length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Private mode / quota: drafts are a convenience, never required.
  }
}

/** Returns null when there is nothing to restore. */
export function readMealDraft<T>(userId: string, date: string, mealType: string): T[] | null {
  const draft = readAll()[draftKey(userId, date, mealType)]
  return draft ? (draft.items as T[]) : null
}

/**
 * Saves the whole in-progress row list for this meal. `isEmpty` decides
 * whether the caller's `items` are worth persisting (e.g. a single row with
 * no name and no weight typed is not); when true the draft is cleared instead.
 */
export function writeMealDraft<T>(userId: string, date: string, mealType: string, items: T[], isEmpty: boolean) {
  const map = readAll()
  const key = draftKey(userId, date, mealType)
  if (isEmpty) delete map[key]
  else map[key] = { items, updatedAt: new Date().toISOString() }
  writeAll(map)
}

export function clearMealDraft(userId: string, date: string, mealType: string) {
  const map = readAll()
  delete map[draftKey(userId, date, mealType)]
  writeAll(map)
}
