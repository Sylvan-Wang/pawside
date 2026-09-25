'use client'

import PageHeader from '@/components/PageHeader'
import ExerciseMotion from '@/components/workout/ExerciseMotion'
import type { ExerciseMedia } from '@/lib/exercise-media'
import {
  clearTodayTrainingCache,
  clearTrainingSessionCache,
  readTrainingSessionCache,
  warmTrainingSessionCache,
} from '@/lib/training-navigation-cache'
import {
  getPendingSetActual,
  hasPendingSetActual,
  listPendingSetActuals,
  queueSetActual,
  removePendingSetActual,
  removePendingSetActualByKey,
} from '@/lib/training-offline-queue'
import type { SaveSetActualInput } from '@/lib/contracts/training-runtime'
import { SESSION_MINUTE_OPTIONS, type SessionMinutes } from '@/lib/training-duration'
import {
  kgToWeightInput,
  normalizeTrainingWeightUnit,
  weightInputToKg,
  type TrainingWeightUnit,
} from '@/lib/training-weight-unit'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface PlannedSet {
  id: string
  set_index: number
  target_reps_min: number | null
  target_reps_max: number | null
  target_weight_kg: number | null
}

interface ActualSet {
  id: string
  set_index: number
  actual_weight_kg: number | null
  actual_reps: number | null
  actual_rir: number | null
  status: string
  is_extra: boolean
}

interface ExerciseExecution {
  id: string
  order_index: number
  status: string
  exercise: { canonical_name_zh: string } | null
  prescription: {
    target_summary_zh: string | null
    target_weight_kg: number | null
    sets: PlannedSet[]
  } | null
  sets: ActualSet[]
  media: ExerciseMedia | null
  /** Minimum P1 §4.2: every prescribed set of this exercise is completed. */
  fully_completed?: boolean
}

interface TrainingSession {
  id: string
  split_key: 'push' | 'pull' | 'legs'
  status: 'started' | 'completed'
  view_date: string
  performed_at: string
  performed_time_zone: string
  log_date: string
  execution_mode: 'canonical' | 'replay' | 'supplemental'
  started_at: string
  completed_at: string | null
  selected_session_minutes?: number | null
  selection_source?: string | null
  required_exercise_count?: number | null
  original_exercise_count?: number | null
  completion_policy_version?: string | null
}

/** Minimum P1 §13.2: server-derived exercise-count threshold progress. */
interface SessionProgress {
  original_exercise_count: number
  required_exercise_count: number
  completed_exercise_count: number
  selected_session_minutes: number | null
  selection_source: string | null
  completion_policy_version: string | null
  can_complete: boolean
  program_day_completed: boolean
}

interface SessionResponse {
  viewer_id: string
  preferred_weight_unit: TrainingWeightUnit
  session: TrainingSession
  exercises: ExerciseExecution[]
  progress: SessionProgress
}

interface SetDraft {
  setIndex: number
  weight: string
  weightKg: number | null
  reps: string
  rir: string
  saved: boolean
  isExtra: boolean
  pending: boolean
}

interface CompletionResult {
  next_split_key: 'push' | 'pull' | 'legs'
  current_cycle_number: number
  cycle_completed: boolean
  progression_advanced: boolean
  session_sequence_advanced?: boolean
  program_day_completed?: boolean
  completed_exercise_count?: number
  required_exercise_count?: number
  original_exercise_count?: number
  selected_session_minutes?: number | null
  execution_mode?: string
  log_date: string
}

const splitNames = { push: '推', pull: '拉', legs: '腿' }
const WEIGHT_UNIT_STORAGE_KEY = 'pawside:training:weight-unit:v1'

function preferredWeightUnit(profileUnit: TrainingWeightUnit) {
  if (typeof window === 'undefined') return profileUnit
  try {
    return normalizeTrainingWeightUnit(window.localStorage.getItem(WEIGHT_UNIT_STORAGE_KEY) || profileUnit)
  } catch {
    return profileUnit
  }
}

function restorePendingDrafts(
  base: SetDraft[],
  exercise: ExerciseExecution,
  userId: string,
  sessionId: string,
  weightUnit: TrainingWeightUnit,
) {
  const drafts = [...base]
  for (const pending of listPendingSetActuals(userId, sessionId)) {
    if (pending.payload.exercise_execution_id !== exercise.id) continue
    const existing = drafts.find((draft) => draft.setIndex === pending.payload.set_index)
    if (existing) continue
    drafts.push({
      setIndex: pending.payload.set_index,
      weight: kgToWeightInput(pending.payload.actual_weight_kg ?? null, weightUnit),
      weightKg: pending.payload.actual_weight_kg ?? null,
      reps: String(pending.payload.actual_reps),
      rir: pending.payload.actual_rir == null ? '' : String(pending.payload.actual_rir),
      saved: false,
      isExtra: true,
      pending: true,
    })
  }
  return drafts.sort((a, b) => a.setIndex - b.setIndex)
}

function initialDrafts(
  exercise: ExerciseExecution,
  userId: string,
  sessionId: string,
  weightUnit: TrainingWeightUnit,
): SetDraft[] {
  if (exercise.sets.length > 0) {
    return restorePendingDrafts([...exercise.sets]
      .sort((a, b) => a.set_index - b.set_index)
      .map((set) => {
        const pending = getPendingSetActual(userId, sessionId, exercise.id, set.set_index)
        return {
          setIndex: set.set_index,
          weight: kgToWeightInput(
            pending ? pending.payload.actual_weight_kg ?? null : set.actual_weight_kg,
            weightUnit,
          ),
          weightKg: pending ? pending.payload.actual_weight_kg ?? null : set.actual_weight_kg,
          reps: pending ? String(pending.payload.actual_reps) : set.actual_reps == null ? '' : String(set.actual_reps),
          rir: pending
            ? pending.payload.actual_rir == null ? '' : String(pending.payload.actual_rir)
            : set.actual_rir == null ? '' : String(set.actual_rir),
          saved: !pending && set.status === 'completed',
          isExtra: set.is_extra,
          pending: Boolean(pending),
        }
      }), exercise, userId, sessionId, weightUnit)
  }

  const planned = exercise.prescription?.sets ?? []
  if (planned.length > 0) {
    return restorePendingDrafts([...planned]
      .sort((a, b) => a.set_index - b.set_index)
      .map((set) => {
        const pending = getPendingSetActual(userId, sessionId, exercise.id, set.set_index)
        return {
          setIndex: set.set_index,
          weight: kgToWeightInput(
            pending ? pending.payload.actual_weight_kg ?? null : set.target_weight_kg,
            weightUnit,
          ),
          weightKg: pending ? pending.payload.actual_weight_kg ?? null : set.target_weight_kg,
          reps: pending ? String(pending.payload.actual_reps) : '',
          rir: pending?.payload.actual_rir == null ? '' : String(pending.payload.actual_rir),
          saved: false,
          isExtra: false,
          pending: Boolean(pending),
        }
      }), exercise, userId, sessionId, weightUnit)
  }

  return restorePendingDrafts(
    [{ setIndex: 1, weight: '', weightKg: null, reps: '', rir: '', saved: false, isExtra: true, pending: false }],
    exercise,
    userId,
    sessionId,
    weightUnit,
  )
}

/**
 * Minimum P1 §4.2 / §5, mirrored from complete_method_session_v2 and the session
 * API: an exercise counts only when EVERY prescribed set of that exercise is
 * completed. Extra sets beyond the prescription are ignored. A set that is only
 * queued offline does not count yet, matching the server.
 */
function countFullyCompletedExercises(
  exercises: ExerciseExecution[],
  drafts: Record<string, SetDraft[]>,
) {
  return exercises.filter((item) => {
    const prescribed = item.sets.filter((set) => !set.is_extra)
    if (prescribed.length === 0) return true
    const itemDrafts = drafts[item.id] ?? []
    return prescribed.every((set) => {
      const draft = itemDrafts.find((candidate) => candidate.setIndex === set.set_index)
      return draft ? draft.saved : set.status === 'completed'
    })
  }).length
}

export default function TrainingSessionPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId
  const [data, setData] = useState<SessionResponse | null>(null)
  const [drafts, setDrafts] = useState<Record<string, SetDraft[]>>({})
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0)
  const [weightUnit, setWeightUnit] = useState<TrainingWeightUnit>('kg')
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [changingDuration, setChangingDuration] = useState(false)
  const [exerciseActionId, setExerciseActionId] = useState('')
  const [error, setError] = useState('')
  const [completion, setCompletion] = useState<CompletionResult | null>(null)
  const completionRequestId = useRef<string | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      const cached = readTrainingSessionCache<SessionResponse>(sessionId)
      if (cached) {
        const unit = preferredWeightUnit(cached.preferred_weight_unit)
        setData(cached)
        setWeightUnit(unit)
        setDrafts(Object.fromEntries(cached.exercises.map((exercise) => [
          exercise.id,
          initialDrafts(exercise, cached.viewer_id, sessionId, unit),
        ])))
        const firstOpen = cached.exercises.findIndex((exercise) => !['completed', 'skipped'].includes(exercise.status))
        setActiveExerciseIndex(firstOpen >= 0 ? firstOpen : 0)
        setLoading(false)
        return
      }

      try {
        const nextData = await warmTrainingSessionCache<SessionResponse>(sessionId)
        if (!active) return
        const unit = preferredWeightUnit(nextData.preferred_weight_unit)
        setData(nextData)
        setWeightUnit(unit)
        setDrafts(Object.fromEntries(nextData.exercises.map((exercise) => [
          exercise.id,
          initialDrafts(exercise, nextData.viewer_id, sessionId, unit),
        ])))
        const firstOpen = nextData.exercises.findIndex((exercise) => !['completed', 'skipped'].includes(exercise.status))
        setActiveExerciseIndex(firstOpen >= 0 ? firstOpen : 0)
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : '暂时无法读取训练')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [sessionId])

  useEffect(() => {
    if (!data) return
    const retry = () => { void syncPendingSetActuals() }
    window.addEventListener('online', retry)
    if (window.navigator.onLine) retry()
    return () => window.removeEventListener('online', retry)
    // syncPendingSetActuals intentionally reads the latest drafts through state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.viewer_id, sessionId])

  useEffect(() => {
    const nextMedia = data?.exercises[activeExerciseIndex + 1]?.media
    if (!nextMedia) return

    const timer = window.setTimeout(() => {
      nextMedia.frames.forEach((frame) => {
        const preload = new Image()
        preload.decoding = 'async'
        preload.src = frame.url
      })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [activeExerciseIndex, data])

  function updateDraft(executionId: string, position: number, field: 'weight' | 'reps' | 'rir', value: string) {
    const setIndex = drafts[executionId][position].setIndex
    if (data) removePendingSetActualByKey(data.viewer_id, sessionId, executionId, setIndex)
    setDrafts((current) => ({
      ...current,
      [executionId]: current[executionId].map((draft, index) => (
        index === position
          ? {
              ...draft,
              [field]: value,
              ...(field === 'weight' ? {
                weightKg: value === '' ? null : weightInputToKg(Number(value), weightUnit),
              } : {}),
              saved: false,
              pending: false,
            }
          : draft
      )),
    }))
  }

  function selectWeightUnit(nextUnit: TrainingWeightUnit) {
    if (nextUnit === weightUnit) return
    try {
      window.localStorage.setItem(WEIGHT_UNIT_STORAGE_KEY, nextUnit)
    } catch {
      // A private browser may reject storage; the current session still switches units.
    }
    setDrafts((current) => Object.fromEntries(
      Object.entries(current).map(([executionId, exerciseDrafts]) => [
        executionId,
        exerciseDrafts.map((draft) => ({
          ...draft,
          weight: kgToWeightInput(draft.weightKg, nextUnit),
        })),
      ]),
    ))
    setWeightUnit(nextUnit)
  }

  function addSet(executionId: string) {
    setDrafts((current) => {
      const existing = current[executionId]
      const nextIndex = Math.max(...existing.map((draft) => draft.setIndex), 0) + 1
      return {
        ...current,
        [executionId]: [...existing, {
          setIndex: nextIndex,
          weight: '',
          weightKg: null,
          reps: '',
          rir: '',
          saved: false,
          isExtra: true,
          pending: false,
        }],
      }
    })
  }

  function showExercise(index: number) {
    if (!data || index < 0 || index >= data.exercises.length) return
    setActiveExerciseIndex(index)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function buildSetPayload(executionId: string, position: number): SaveSetActualInput | null {
    const draft = drafts[executionId][position]
    const reps = Number(draft.reps)
    if (draft.reps === '' || !Number.isInteger(reps) || reps < 0) {
      setError('请填写这一组实际完成的次数')
      return null
    }
    return {
      exercise_execution_id: executionId,
      set_index: draft.setIndex,
      actual_weight_kg: draft.weightKg,
      actual_reps: reps,
      actual_rir: draft.rir === '' ? null : Number(draft.rir),
    }
  }

  async function sendSetActual(payload: SaveSetActualInput) {
    return fetch(`/api/training/sessions/${sessionId}/sets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function syncPendingSetActuals() {
    if (!data || !window.navigator.onLine) return
    for (const item of listPendingSetActuals(data.viewer_id, sessionId)) {
      try {
        const response = await sendSetActual(item.payload)
        if (!response.ok) {
          if (response.status < 500) removePendingSetActual(item)
          continue
        }
        removePendingSetActual(item)
        setDrafts((current) => ({
          ...current,
          [item.payload.exercise_execution_id]: current[item.payload.exercise_execution_id]?.map((draft) => (
            draft.setIndex === item.payload.set_index ? { ...draft, saved: true, pending: false } : draft
          )) ?? [],
        }))
      } catch {
        return
      }
    }
    clearTrainingSessionCache(sessionId)
  }

  async function saveSet(executionId: string, position: number) {
    if (!data) return
    const requestPayload = buildSetPayload(executionId, position)
    if (!requestPayload) return
    const draft = drafts[executionId][position]
    const key = `${executionId}:${draft.setIndex}`
    const pending = { userId: data.viewer_id, sessionId, payload: requestPayload, queuedAt: new Date().toISOString() }
    setSavingKey(key)
    setError('')
    queueSetActual(pending)
    setDrafts((current) => ({
      ...current,
      [executionId]: current[executionId].map((item, index) => (
        index === position ? { ...item, saved: false, pending: true } : item
      )),
    }))
    try {
      const response = await sendSetActual(requestPayload)
      const result = await response.json()
      if (!response.ok) {
        if (response.status < 500) removePendingSetActual(pending)
        throw new Error(result?.error?.message || '保存失败')
      }
      removePendingSetActual(pending)
      setDrafts((current) => ({
        ...current,
        [executionId]: current[executionId].map((item, index) => (
          index === position ? { ...item, saved: true, pending: false } : item
        )),
      }))
      clearTrainingSessionCache(sessionId)
    } catch (reason: unknown) {
      const offline = !window.navigator.onLine || reason instanceof TypeError
      const stillPending = hasPendingSetActual(data.viewer_id, sessionId, executionId, draft.setIndex)
      setDrafts((current) => ({
        ...current,
        [executionId]: current[executionId].map((item, index) => (
          index === position ? { ...item, pending: stillPending } : item
        )),
      }))
      setError(offline ? '已暂存在本机，联网后会自动同步' : reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSavingKey('')
    }
  }

  async function setExerciseStatus(executionId: string, action: 'skip' | 'resume') {
    setExerciseActionId(executionId)
    setError('')
    try {
      const response = await fetch(`/api/training/sessions/${sessionId}/exercises/${executionId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error?.message || '动作状态更新失败')
      setData((current) => current ? {
        ...current,
        exercises: current.exercises.map((item) => item.id === executionId
          ? { ...item, status: result.data.status }
          : item),
      } : current)
      clearTrainingSessionCache(sessionId)
      if (action === 'skip' && activeExerciseIndex < (data?.exercises.length ?? 0) - 1) {
        showExercise(activeExerciseIndex + 1)
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '动作状态更新失败')
    } finally {
      setExerciseActionId('')
    }
  }

  async function completeSession() {
    setFinishing(true)
    setError('')
    try {
      await syncPendingSetActuals()
      if (data && listPendingSetActuals(data.viewer_id, sessionId).length > 0) {
        throw new Error('仍有训练记录等待联网同步，请联网后再完成本次训练')
      }
      completionRequestId.current ??= window.crypto.randomUUID()
      const response = await fetch(`/api/training/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completion_request_id: completionRequestId.current }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || '暂时无法完成训练')
      setCompletion(payload.data)
      clearTrainingSessionCache(sessionId)
      clearTodayTrainingCache()
      setData((current) => current ? {
        ...current,
        session: { ...current.session, status: 'completed', completed_at: new Date().toISOString() },
      } : current)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '暂时无法完成训练')
    } finally {
      setFinishing(false)
    }
  }

  /**
   * Minimum P1 §7: shorten (or lengthen) the threshold of an ACTIVE session.
   * No session is recreated, no set actual is discarded, and the Method
   * prescription and long-term preference are untouched.
   */
  async function changeDuration(minutes: SessionMinutes) {
    if (!data || data.session.status !== 'started' || changingDuration) return
    setChangingDuration(true)
    setError('')
    try {
      const response = await fetch(`/api/training/sessions/${sessionId}/duration`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_session_minutes: minutes,
          selection_source: 'mid_session_change',
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || '暂时无法调整训练时长')
      setData((current) => current ? {
        ...current,
        session: {
          ...current.session,
          selected_session_minutes: payload.data.selected_session_minutes,
          selection_source: payload.data.selection_source,
          required_exercise_count: payload.data.required_exercise_count,
        },
        progress: {
          ...current.progress,
          selected_session_minutes: payload.data.selected_session_minutes,
          selection_source: payload.data.selection_source,
          required_exercise_count: payload.data.required_exercise_count,
        },
      } : current)
      clearTrainingSessionCache(sessionId)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '暂时无法调整训练时长')
    } finally {
      setChangingDuration(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title="训练中" back /><p className="p-5 text-sm text-gray-500">正在恢复训练记录…</p></div>
  }

  if (!data) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title="训练中" back /><p className="p-5 text-sm text-red-500">{error || '训练记录不存在'}</p></div>
  }

  const exercise = data.exercises[activeExerciseIndex]
  if (!exercise) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title="训练中" back /><p className="p-5 text-sm text-gray-500">本次训练没有动作。</p></div>
  }

  const isCompleted = data.session.status === 'completed'
  const exerciseName = exercise.exercise?.canonical_name_zh || `动作 ${exercise.order_index}`
  const exerciseDrafts = drafts[exercise.id] ?? []
  const savedSetCount = exerciseDrafts.filter((draft) => draft.saved).length
  const isLastExercise = activeExerciseIndex === data.exercises.length - 1
  const exerciseFullyCompleted = (() => {
    const prescribed = exercise.sets.filter((set) => !set.is_extra)
    if (prescribed.length === 0) return true
    return prescribed.every((set) => {
      const draft = exerciseDrafts.find((candidate) => candidate.setIndex === set.set_index)
      return draft ? draft.saved : set.status === 'completed'
    })
  })()

  // Minimum P1 §13.2: exercise-count progress, derived from the same rule the
  // server enforces so the CTA never disagrees with the completion gate.
  const requiredExerciseCount = data.progress.required_exercise_count
  const completedExerciseCount = countFullyCompletedExercises(data.exercises, drafts)
  const canComplete = !isCompleted && completedExerciseCount >= requiredExerciseCount

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title={`${splitNames[data.session.split_key]}训练`} back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>{isCompleted ? '本次训练已完成' : '实际训练记录'}</span>
            <span>动作 {activeExerciseIndex + 1} / {data.exercises.length}</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold">{splitNames[data.session.split_key]}训练</h1>
          <span className="sr-only" aria-live="polite">
            当前为第 {activeExerciseIndex + 1} 个动作，共 {data.exercises.length} 个动作
          </span>
          <div className="mt-4 rounded-xl bg-white/10 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {isCompleted
                  ? '本次训练已完成'
                  : canComplete
                    ? '今天的训练已达成'
                    : `完成任意 ${requiredExerciseCount} 个动作，就可以结束今天的训练`}
              </span>
              <span className="shrink-0 tabular-nums">{completedExerciseCount} / {requiredExerciseCount}</span>
            </div>
            {!isCompleted && (
              <div className="mt-3">
                <p className="text-xs text-white/60">
                  本次训练时长 {data.progress.selected_session_minutes ?? '-'} 分钟
                  {data.progress.selection_source === 'mid_session_change' ? ' · 训练中已调整' : ''}
                </p>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5" role="group" aria-label="调整本次训练时长">
                  {SESSION_MINUTE_OPTIONS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      disabled={changingDuration}
                      onClick={() => changeDuration(minutes)}
                      className={`rounded-lg py-1.5 text-xs font-medium disabled:opacity-50 ${
                        data.progress.selected_session_minutes === minutes
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-white'
                      }`}
                    >
                      {minutes}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-1.5" role="group" aria-label="选择训练动作">
            {data.exercises.map((item, index) => (
              <button key={item.id} type="button" onClick={() => showExercise(index)}
                aria-label={`查看动作 ${index + 1}`}
                className={`h-1.5 flex-1 rounded-full ${index <= activeExerciseIndex ? 'bg-white' : 'bg-white/20'}`} />
            ))}
          </div>
        </header>

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

        <section key={exercise.id} className="rounded-2xl bg-white p-4" aria-labelledby={`exercise-${exercise.id}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400">动作 {exercise.order_index}</p>
              <h2 id={`exercise-${exercise.id}`} className="mt-1 font-semibold text-gray-900">{exerciseName}</h2>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {savedSetCount} / {exerciseDrafts.length} 组
              </span>
              {exerciseFullyCompleted && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                  已计入完成数
                </span>
              )}
            </div>
          </div>

          {exercise.prescription?.target_summary_zh && (
            <p className="mt-1 text-sm text-gray-500">今天建议：{exercise.prescription.target_summary_zh}</p>
          )}

          {!isCompleted && (
            <div className="mt-3 flex gap-2">
              {exercise.status === 'skipped' ? (
                <button type="button" onClick={() => setExerciseStatus(exercise.id, 'resume')}
                  disabled={exerciseActionId === exercise.id}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium disabled:opacity-50">
                  恢复这个动作
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => showExercise(Math.min(activeExerciseIndex + 1, data.exercises.length - 1))}
                    disabled={isLastExercise}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium disabled:opacity-40">
                    稍后做
                  </button>
                  <button type="button" onClick={() => setExerciseStatus(exercise.id, 'skip')}
                    disabled={exerciseActionId === exercise.id || savedSetCount > 0}
                    className="rounded-lg px-3 py-2 text-sm text-gray-500 disabled:opacity-40">
                    跳过动作
                  </button>
                </>
              )}
            </div>
          )}

          {exercise.media && (
            <ExerciseMotion key={exercise.id} name={exerciseName} media={exercise.media} loading="eager" />
          )}

          <div className="mt-4 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
            <span className="text-xs text-gray-500">重量单位</span>
            <div className="flex rounded-lg bg-white p-0.5" role="group" aria-label="重量单位">
              {(['kg', 'lb'] as const).map((unit) => (
                <button key={unit} type="button" onClick={() => selectWeightUnit(unit)}
                  aria-pressed={weightUnit === unit}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${weightUnit === unit ? 'bg-black text-white' : 'text-gray-500'}`}>
                  {unit}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {exerciseDrafts.map((draft, position) => {
              const key = `${exercise.id}:${draft.setIndex}`
              return (
                <div key={draft.setIndex} className="rounded-xl border border-gray-100 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">第 {draft.setIndex} 组{draft.isExtra ? ' · 实际记录' : ''}</span>
                    <span className={`text-xs ${draft.pending ? 'text-amber-600' : draft.saved ? 'text-green-600' : 'text-gray-400'}`}>
                      {draft.pending ? '待同步' : draft.saved ? '已保存' : '待保存'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-xs text-gray-500">
                      重量 {weightUnit}
                      <input type="number" min="0" step={weightUnit === 'lb' ? '1' : '0.5'} value={draft.weight} disabled={isCompleted || exercise.status === 'skipped'}
                        onChange={(event) => updateDraft(exercise.id, position, 'weight', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                    </label>
                    <label className="text-xs text-gray-500">
                      实际次数
                      <input type="number" min="0" step="1" value={draft.reps} disabled={isCompleted || exercise.status === 'skipped'}
                        onChange={(event) => updateDraft(exercise.id, position, 'reps', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                    </label>
                    <label className="text-xs text-gray-500">
                      还能再做
                      <input type="number" min="0" max="20" step="1" value={draft.rir} disabled={isCompleted || exercise.status === 'skipped'}
                        onChange={(event) => updateDraft(exercise.id, position, 'rir', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                    </label>
                  </div>
                  {!isCompleted && (
                    <button type="button" onClick={() => saveSet(exercise.id, position)} disabled={savingKey === key || exercise.status === 'skipped'}
                      className="mt-3 w-full rounded-lg border border-gray-200 py-2 text-sm font-medium disabled:opacity-50">
                      {savingKey === key ? '保存中…' : draft.saved ? '更新这一组' : '完成这一组'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {!isCompleted && (
            <button type="button" onClick={() => addSet(exercise.id)} className="mt-3 text-sm font-medium text-gray-700">
              + 记录额外一组
            </button>
          )}
        </section>

        <nav className="grid grid-cols-2 gap-3" aria-label="训练动作切换">
          <button type="button" onClick={() => showExercise(activeExerciseIndex - 1)}
            disabled={activeExerciseIndex === 0}
            className="rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 disabled:opacity-35">
            上一个动作
          </button>
          <button type="button" onClick={() => showExercise(activeExerciseIndex + 1)}
            disabled={isLastExercise}
            className="rounded-xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-35">
            下一个动作
          </button>
        </nav>

        {isCompleted ? (
          <section className="rounded-2xl bg-white p-5">
            <h2 className="font-semibold text-gray-900">今天的训练已记录</h2>
            <p className="mt-2 text-sm text-gray-600">
              {completion && !(completion.program_day_completed ?? completion.progression_advanced)
                ? `补充训练已归入 ${completion.log_date}，不会改变当前训练顺序。`
                : completion
                  ? completion.cycle_completed
                  ? `第 ${completion.current_cycle_number - 1} 轮已完成，下一次从推训练开始。`
                    : `下一次继续${splitNames[completion.next_split_key]}训练。`
                  : '本次实际训练已经保存。'}
            </p>
            <button type="button" onClick={() => router.push('/training/today')}
              className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-semibold text-white">
              查看训练计划
            </button>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-4">
            {canComplete ? (
              <>
                <p className="text-sm font-medium text-gray-900">今天的训练已达成</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  还有时间或体力可以继续做剩余动作；不做也不会影响这个训练日。
                </p>
                <button type="button" onClick={completeSession} disabled={finishing || savingKey !== ''}
                  className="mt-3 w-full rounded-xl bg-black py-3.5 text-sm font-semibold text-white disabled:opacity-50">
                  {finishing ? '正在完成…' : '结束今天训练'}
                </button>
              </>
            ) : (
              <p className="text-xs leading-5 text-gray-500">
                完整完成任意 {requiredExerciseCount} 个动作即可结束这个训练日（当前 {completedExerciseCount} / {requiredExerciseCount}）。
                已保存的记录都会保留，随时可以离开，稍后继续。
              </p>
            )}
            <button type="button" onClick={() => router.push('/training/today')}
              className="mt-2 w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-700">
              稍后继续
            </button>
            {!isLastExercise && (
              <p className="mt-3 text-center text-xs text-gray-400">
                下一动作素材正在后台准备，已填写内容会保留在本次训练中。
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
