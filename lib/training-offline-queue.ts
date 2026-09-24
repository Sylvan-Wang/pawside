import type { SaveSetActualInput } from '@/lib/contracts/training-runtime'

export interface PendingSetActual {
  userId: string
  sessionId: string
  payload: SaveSetActualInput
  queuedAt: string
}

const STORAGE_KEY = 'pawside-training-pending-v1'

function pendingKey(item: Pick<PendingSetActual, 'userId' | 'sessionId' | 'payload'>) {
  return [item.userId, item.sessionId, item.payload.exercise_execution_id, item.payload.set_index].join(':')
}

function readAll(): PendingSetActual[] {
  if (typeof window === 'undefined') return []
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as PendingSetActual[] : []
  } catch {
    return []
  }
}

function writeAll(items: PendingSetActual[]) {
  if (typeof window === 'undefined') return
  if (items.length === 0) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function listPendingSetActuals(userId: string, sessionId: string) {
  return readAll().filter((item) => item.userId === userId && item.sessionId === sessionId)
}

export function queueSetActual(item: PendingSetActual) {
  const key = pendingKey(item)
  const items = readAll().filter((candidate) => pendingKey(candidate) !== key)
  items.push(item)
  writeAll(items)
}

export function removePendingSetActual(item: Pick<PendingSetActual, 'userId' | 'sessionId' | 'payload'>) {
  const key = pendingKey(item)
  writeAll(readAll().filter((candidate) => pendingKey(candidate) !== key))
}

export function removePendingSetActualByKey(
  userId: string,
  sessionId: string,
  exerciseExecutionId: string,
  setIndex: number,
) {
  const key = [userId, sessionId, exerciseExecutionId, setIndex].join(':')
  writeAll(readAll().filter((candidate) => pendingKey(candidate) !== key))
}

export function getPendingSetActual(
  userId: string,
  sessionId: string,
  exerciseExecutionId: string,
  setIndex: number,
) {
  return listPendingSetActuals(userId, sessionId).find((item) => (
    item.payload.exercise_execution_id === exerciseExecutionId && item.payload.set_index === setIndex
  ))
}

export function hasPendingSetActual(
  userId: string,
  sessionId: string,
  exerciseExecutionId: string,
  setIndex: number,
) {
  return Boolean(getPendingSetActual(userId, sessionId, exerciseExecutionId, setIndex))
}
