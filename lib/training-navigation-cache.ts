const TODAY_CACHE_PREFIX = 'pawside:training:date:v2:'
const SESSION_CACHE_PREFIX = 'pawside:training:session:v1:'
const CACHE_TTL_MS = 60_000
const pendingSessionLoads = new Map<string, Promise<unknown>>()
let sessionCacheGeneration = 0

interface CacheEnvelope<T> {
  cachedAt: number
  value: T
}

function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (!envelope.cachedAt || Date.now() - envelope.cachedAt > CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return envelope.value
  } catch {
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // Storage can be unavailable in private or constrained browser contexts.
    }
    return null
  }
}

function writeCache<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), value }))
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
  }
}

function todayCacheKey(viewDate = 'current') {
  return TODAY_CACHE_PREFIX + viewDate
}

export function readTodayTrainingCache<T>(viewDate?: string) {
  return readCache<T>(todayCacheKey(viewDate))
}

export function writeTodayTrainingCache<T>(value: T, viewDate?: string) {
  writeCache(todayCacheKey(viewDate), value)
}

export function clearTodayTrainingCache() {
  if (typeof window === 'undefined') return
  try {
    const keysToRemove: string[] = []
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(TODAY_CACHE_PREFIX)) keysToRemove.push(key)
    }
    keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
  }
}

export function readTrainingSessionCache<T>(sessionId: string) {
  return readCache<T>(SESSION_CACHE_PREFIX + sessionId)
}

export function writeTrainingSessionCache<T>(sessionId: string, value: T) {
  writeCache(SESSION_CACHE_PREFIX + sessionId, value)
}

export function warmTrainingSessionCache<T>(sessionId: string): Promise<T> {
  const cached = readTrainingSessionCache<T>(sessionId)
  if (cached) return Promise.resolve(cached)

  const pending = pendingSessionLoads.get(sessionId)
  if (pending) return pending as Promise<T>

  const generation = sessionCacheGeneration
  const request = fetch(`/api/training/sessions/${sessionId}`, { cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || '暂时无法读取训练记录')
      const value = payload.data as T
      if (generation === sessionCacheGeneration) writeTrainingSessionCache(sessionId, value)
      return value
    })
    .finally(() => {
      pendingSessionLoads.delete(sessionId)
    })

  pendingSessionLoads.set(sessionId, request)
  return request
}

export function clearTrainingSessionCache(sessionId: string) {
  if (typeof window === 'undefined') return
  sessionCacheGeneration += 1
  pendingSessionLoads.delete(sessionId)
  try {
    window.sessionStorage.removeItem(SESSION_CACHE_PREFIX + sessionId)
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
  }
}

export function clearTrainingNavigationCache() {
  if (typeof window === 'undefined') return
  sessionCacheGeneration += 1
  pendingSessionLoads.clear()
  try {
    const keysToRemove: string[] = []
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(TODAY_CACHE_PREFIX) || key?.startsWith(SESSION_CACHE_PREFIX)) keysToRemove.push(key)
    }
    keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
  }
}
