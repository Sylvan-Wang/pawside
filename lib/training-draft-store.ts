/**
 * Pawside — unsaved set drafts (coach patch 2026-09-27).
 *
 * Numbers typed into a set but not yet saved with "完成这一组" used to vanish
 * when the user navigated away. They are now kept in localStorage per
 * user + session + exercise execution + set index, and restored on return.
 *
 * Deliberately NOT an auto-submit: saving a set is still an explicit action,
 * because a saved set counts towards completion and progression. This only
 * keeps what was typed. Drafts older than 48 hours are ignored.
 */

export interface StoredSetDraft {
  weight: string
  weightKg: number | null
  reps: string
  rir: string
  /** As typed: seconds for a timed set, minutes for a cardio set. */
  duration?: string
  /** As typed, in kilometres. */
  distance?: string
  updatedAt: string
}

const STORAGE_KEY = 'pawside-training-unsaved-drafts-v1'
const MAX_AGE_MS = 48 * 60 * 60 * 1000

type DraftMap = Record<string, StoredSetDraft>

function draftKey(userId: string, sessionId: string, executionId: string, setIndex: number) {
  return [userId, sessionId, executionId, setIndex].join(':')
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
      if (Number.isFinite(time) && now - time <= MAX_AGE_MS) fresh[key] = value
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

export function readSetDraft(userId: string, sessionId: string, executionId: string, setIndex: number) {
  return readAll()[draftKey(userId, sessionId, executionId, setIndex)] ?? null
}

export function writeSetDraft(
  userId: string,
  sessionId: string,
  executionId: string,
  setIndex: number,
  draft: Omit<StoredSetDraft, 'updatedAt'>,
) {
  const map = readAll()
  const key = draftKey(userId, sessionId, executionId, setIndex)
  if (draft.weight === '' && draft.reps === '' && draft.rir === '' && !draft.duration && !draft.distance) delete map[key]
  else map[key] = { ...draft, updatedAt: new Date().toISOString() }
  writeAll(map)
}

export function clearSetDraft(userId: string, sessionId: string, executionId: string, setIndex: number) {
  const map = readAll()
  delete map[draftKey(userId, sessionId, executionId, setIndex)]
  writeAll(map)
}

export function clearSessionDrafts(userId: string, sessionId: string) {
  const map = readAll()
  const prefix = `${userId}:${sessionId}:`
  for (const key of Object.keys(map)) if (key.startsWith(prefix)) delete map[key]
  writeAll(map)
}
