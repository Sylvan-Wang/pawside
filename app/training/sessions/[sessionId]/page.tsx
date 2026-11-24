'use client'

import PageHeader from '@/components/PageHeader'
import { splitLabel } from '@/lib/split-labels'
import { describeTimedTarget } from '@/lib/workout-log-summary'
import { friendlyTargetSummary } from '@/lib/training-copy'
import CoachCard from '@/components/CoachCard'
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
import { prescribedSetsAreComplete, type CompletionCountUnit } from '@/lib/training-completion'
import { SESSION_MINUTE_OPTIONS, type SessionMinutes } from '@/lib/training-duration'
import {
  kgToWeightInput,
  normalizeTrainingWeightUnit,
  weightInputToKg,
  type TrainingWeightUnit,
} from '@/lib/training-weight-unit'
import { useParams, useRouter } from 'next/navigation'
import { clearSessionDrafts, clearSetDraft, readSetDraft, writeSetDraft } from '@/lib/training-draft-store'
import { describePlannedSet } from '@/lib/coach/set-guidance'
import { useEffect, useRef, useState } from 'react'
import { formatLastTime, type ProgressPoint } from '@/lib/workout/exercise-progress'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/use-locale'
import { translate, type Locale, type MessageKey } from '@/lib/i18n'
import { exerciseDisplayName } from '@/lib/i18n/exercise-names'
import { localizeSetGuidance } from '@/lib/i18n/set-guidance-en'

interface PlannedSet {
  id: string
  set_index: number
  target_reps_min: number | null
  target_reps_max: number | null
  target_weight_kg: number | null
  target_duration_seconds?: number | null
  target_distance_m?: number | null
  // Coach patch 2026-09-27: already returned by set_prescriptions(*), now rendered.
  set_type?: string | null
  target_rpe?: number | null
  target_rir?: number | null
  failure_allowed?: boolean | null
  failure_required?: boolean | null
  rest_min_seconds?: number | null
  rest_max_seconds?: number | null
  quality_requirement?: string | null
}

interface ActualSet {
  id: string
  set_index: number
  actual_weight_kg: number | null
  actual_reps: number | null
  actual_rir: number | null
  actual_duration_seconds?: number | null
  actual_distance_m?: number | null
  status: string
  is_extra: boolean
}

interface ExerciseExecution {
  id: string
  exercise_id?: string
  order_index: number
  status: string
  exercise: { canonical_name_zh: string; record_shape?: RecordShape } | null
  prescription: {
    target_summary_zh: string | null
    target_weight_kg: number | null
    sets: PlannedSet[]
  } | null
  sets: ActualSet[]
  media: ExerciseMedia | null
  /** Verified tutorial link, already filtered by the API; null hides the link. */
  tutorial_url?: string | null
  /** Minimum P1 §4.2: every prescribed set of this exercise is completed. */
  fully_completed?: boolean
}

interface TrainingSession {
  id: string
  split_key: string
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
  required_count: number
  completed_count: number
  completion_count_unit: CompletionCountUnit
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
  /** #48「上次」一行：开关 NEXT_PUBLIC_EXERCISE_PROGRESS 打开时才有，按 exercise_id。 */
  last_points?: Record<string, ProgressPoint>
}

interface SetDraft {
  setIndex: number
  weight: string
  weightKg: number | null
  reps: string
  rir: string
  /** Seconds for a timed set, minutes for a cardio set (as typed). */
  duration: string
  /** Kilometres (as typed). */
  distance: string
  saved: boolean
  isExtra: boolean
  pending: boolean
  /** Typed earlier but never saved; restored from this device. */
  restored?: boolean
}

interface CompletionResult {
  next_split_key: string
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
  workout_log_id?: string | null
}

interface SessionFeedbackView {
  workoutLogId: string
  facts: {
    duration_minutes: number | null
    completed_exercise_count: number
    completed_set_count: number | null
    total_volume_kg: number | null
    record_completeness: string
    duration_excluded?: boolean
  }
  signals: Array<{ signal_key: string; text: string; authority: string }>
  /** loading → ready (AI text) or failed (rule cards shown as 基础总结). */
  aiState: 'loading' | 'ready' | 'failed'
  ai: null | {
    summary: string
    observations: Array<{ text: string }>
    next_actions: Array<{ text: string }>
    data_quality_tip: string | null
  }
  provenance: null | {
    prompt_version: string
    model: string
    input_snapshot_id: string
    evidence_registry_version: string
  }
  rating: 'liked' | 'disliked' | null
}

const WEIGHT_UNIT_STORAGE_KEY = 'pawside:training:weight-unit:v1'
// Patch B · B5 (D1): a session left "started" this long triggers the
// reopened-old-session banner. One place to change if the threshold moves.
const STALE_SESSION_HOURS = 12

function preferredWeightUnit(profileUnit: TrainingWeightUnit) {
  if (typeof window === 'undefined') return profileUnit
  try {
    return normalizeTrainingWeightUnit(window.localStorage.getItem(WEIGHT_UNIT_STORAGE_KEY) || profileUnit)
  } catch {
    return profileUnit
  }
}

type RecordShape = 'weight_reps' | 'bodyweight_reps' | 'duration' | 'distance_duration'

function shapeOf(exercise: ExerciseExecution): RecordShape {
  return exercise.exercise?.record_shape ?? 'weight_reps'
}

/** Timed sets are typed in seconds, cardio in minutes. */
function secondsToInput(shape: RecordShape, seconds: number | null | undefined) {
  if (seconds == null) return ''
  return shape === 'distance_duration' ? String(Math.round((seconds / 60) * 10) / 10) : String(seconds)
}

function inputToSeconds(shape: RecordShape, text: string) {
  if (text === '') return null
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(shape === 'distance_duration' ? value * 60 : value)
}

function metersToInput(meters: number | null | undefined) {
  if (meters == null) return ''
  return String(Math.round((Number(meters) / 1000) * 100) / 100)
}

function inputToMeters(text: string) {
  if (text === '') return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 1000 * 100) / 100
}

function formatTarget(set: PlannedSet, shape: RecordShape, locale: Locale) {
  return shape === 'duration' || shape === 'distance_duration' ? describeTimedTarget(set, locale) : null
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
      reps: pending.payload.actual_reps == null ? '' : String(pending.payload.actual_reps),
      rir: pending.payload.actual_rir == null ? '' : String(pending.payload.actual_rir),
      duration: secondsToInput(shapeOf(exercise), pending.payload.actual_duration_seconds),
      distance: metersToInput(pending.payload.actual_distance_m),
      saved: false,
      isExtra: true,
      pending: true,
    })
  }
  return drafts.sort((a, b) => a.setIndex - b.setIndex)
}

/** Restores numbers typed earlier but never saved (lib/training-draft-store.ts). */
function overlayStoredDraft(
  draft: SetDraft,
  userId: string,
  sessionId: string,
  executionId: string,
  weightUnit: TrainingWeightUnit,
): SetDraft {
  if (draft.saved || draft.pending) return draft
  const stored = readSetDraft(userId, sessionId, executionId, draft.setIndex)
  if (!stored) return draft
  return {
    ...draft,
    // Re-render from kg so a unit switch since typing stays correct.
    weight: stored.weightKg != null ? kgToWeightInput(stored.weightKg, weightUnit) : stored.weight,
    weightKg: stored.weightKg,
    reps: stored.reps,
    rir: stored.rir,
    duration: stored.duration ?? '',
    distance: stored.distance ?? '',
    restored: true,
  }
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
          reps: pending
            ? pending.payload.actual_reps == null ? '' : String(pending.payload.actual_reps)
            : set.actual_reps == null ? '' : String(set.actual_reps),
          rir: pending
            ? pending.payload.actual_rir == null ? '' : String(pending.payload.actual_rir)
            : set.actual_rir == null ? '' : String(set.actual_rir),
          duration: secondsToInput(
            shapeOf(exercise),
            pending ? pending.payload.actual_duration_seconds : set.actual_duration_seconds,
          ),
          distance: metersToInput(pending ? pending.payload.actual_distance_m : set.actual_distance_m),
          saved: !pending && set.status === 'completed',
          isExtra: set.is_extra,
          pending: Boolean(pending),
        }
      }).map((draft) => overlayStoredDraft(draft, userId, sessionId, exercise.id, weightUnit)), exercise, userId, sessionId, weightUnit)
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
          reps: pending?.payload.actual_reps == null ? '' : String(pending.payload.actual_reps),
          rir: pending?.payload.actual_rir == null ? '' : String(pending.payload.actual_rir),
          duration: secondsToInput(shapeOf(exercise), pending?.payload.actual_duration_seconds),
          distance: metersToInput(pending?.payload.actual_distance_m),
          saved: false,
          isExtra: false,
          pending: Boolean(pending),
        }
      }).map((draft) => overlayStoredDraft(draft, userId, sessionId, exercise.id, weightUnit)), exercise, userId, sessionId, weightUnit)
  }

  return restorePendingDrafts([], exercise, userId, sessionId, weightUnit)
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
    const itemDrafts = drafts[item.id] ?? []
    return prescribedSetsAreComplete(
      item.sets,
      (set) => !set.is_extra,
      (set) => {
        const draft = itemDrafts.find((candidate) => candidate.setIndex === set.set_index)
        return draft ? draft.saved : set.status === 'completed'
      },
    )
  }).length
}

export default function TrainingSessionPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId
  const [locale] = useLocale()
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params)
  const [data, setData] = useState<SessionResponse | null>(null)
  const [drafts, setDrafts] = useState<Record<string, SetDraft[]>>({})
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0)
  const [weightUnit, setWeightUnit] = useState<TrainingWeightUnit>('kg')
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [endingEarly, setEndingEarly] = useState(false)
  const [changingDuration, setChangingDuration] = useState(false)
  const [exerciseActionId, setExerciseActionId] = useState('')
  const [error, setError] = useState('')
  const [staleBannerDismissed, setStaleBannerDismissed] = useState(false)
  const [completion, setCompletion] = useState<CompletionResult | null>(null)
  const [sessionFeedback, setSessionFeedback] = useState<SessionFeedbackView | null>(null)
  const [feedbackSaving, setFeedbackSaving] = useState(false)
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
        if (active) setError(reason instanceof Error ? reason.message : t('session.errors.loadFailed'))
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
    // t only feeds fallback error text; switching language must not reload the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function updateDraft(executionId: string, position: number, field: 'weight' | 'reps' | 'rir' | 'duration' | 'distance', value: string) {
    const current = drafts[executionId][position]
    const setIndex = current.setIndex
    if (data) {
      removePendingSetActualByKey(data.viewer_id, sessionId, executionId, setIndex)
      const next = { ...current, [field]: value }
      writeSetDraft(data.viewer_id, sessionId, executionId, setIndex, {
        weight: next.weight,
        weightKg: field === 'weight'
          ? value === '' ? null : weightInputToKg(Number(value), weightUnit)
          : current.weightKg,
        reps: next.reps,
        rir: next.rir,
        duration: next.duration,
        distance: next.distance,
      })
    }
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
              restored: false,
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
          duration: '',
          distance: '',
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
    const shape = data ? shapeOf(data.exercises.find((item) => item.id === executionId) as ExerciseExecution) : 'weight_reps'
    if (shape === 'duration' || shape === 'distance_duration') {
      const seconds = inputToSeconds(shape, draft.duration)
      if (seconds == null) {
        setError(shape === 'duration' ? t('session.errors.needSeconds') : t('session.errors.needMinutes'))
        return null
      }
      const distanceMeters = shape === 'distance_duration' ? inputToMeters(draft.distance) : null
      if (shape === 'distance_duration' && draft.distance !== '' && distanceMeters == null) {
        setError(t('session.errors.badDistance'))
        return null
      }
      return {
        exercise_execution_id: executionId,
        set_index: draft.setIndex,
        actual_reps: null,
        actual_duration_seconds: seconds,
        actual_distance_m: distanceMeters,
        actual_weight_kg: shape === 'duration' ? draft.weightKg : null,
        actual_rir: null,
      }
    }
    const reps = Number(draft.reps)
    if (draft.reps === '' || !Number.isInteger(reps) || reps < 0) {
      setError(t('session.errors.needReps'))
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
        throw new Error(result?.error?.message || t('session.errors.saveFailed'))
      }
      removePendingSetActual(pending)
      clearSetDraft(data.viewer_id, sessionId, executionId, draft.setIndex)
      setDrafts((current) => ({
        ...current,
        [executionId]: current[executionId].map((item, index) => (
          index === position ? { ...item, saved: true, pending: false, restored: false } : item
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
      setError(offline ? t('session.errors.queuedOffline') : reason instanceof Error ? reason.message : t('session.errors.saveFailed'))
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
      if (!response.ok) throw new Error(result?.error?.message || t('session.errors.statusFailed'))
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
      setError(reason instanceof Error ? reason.message : t('session.errors.statusFailed'))
    } finally {
      setExerciseActionId('')
    }
  }

  async function endEarly() {
    if (endingEarly) return
    setEndingEarly(true)
    setError('')
    try {
      await syncPendingSetActuals()
      if (data && listPendingSetActuals(data.viewer_id, sessionId).length > 0) {
        throw new Error(t('session.errors.pendingSyncEnd'))
      }
      const response = await fetch(`/api/training/sessions/${sessionId}/end`, { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || t('session.errors.endFailed'))
      if (data) clearSessionDrafts(data.viewer_id, sessionId)
      clearTrainingSessionCache(sessionId)
      clearTodayTrainingCache()
      router.push('/training/today')
    } catch (reason: unknown) {
      setConfirmEnd(false)
      setError(reason instanceof Error ? reason.message : t('session.errors.endFailed'))
    } finally {
      setEndingEarly(false)
    }
  }

  async function completeSession(): Promise<boolean> {
    setFinishing(true)
    setError('')
    try {
      await syncPendingSetActuals()
      if (data && listPendingSetActuals(data.viewer_id, sessionId).length > 0) {
        throw new Error(t('session.errors.pendingSyncComplete'))
      }
      completionRequestId.current ??= window.crypto.randomUUID()
      const response = await fetch(`/api/training/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completion_request_id: completionRequestId.current }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || t('session.errors.completeFailed'))
      setCompletion(payload.data)
      if (data) clearSessionDrafts(data.viewer_id, sessionId)
      if (payload.data?.log_date) {
        sessionStorage.removeItem(`ai_review_${payload.data.log_date}`)
        sessionStorage.removeItem(`ai_summary_${payload.data.log_date}`)
        sessionStorage.removeItem(`ai_review_v3_${payload.data.log_date}`)
        sessionStorage.removeItem(`ai_summary_v3_${payload.data.log_date}`)
      }
      clearTrainingSessionCache(sessionId)
      clearTodayTrainingCache()
      setData((current) => current ? {
        ...current,
        session: { ...current.session, status: 'completed', completed_at: new Date().toISOString() },
      } : current)

      const workoutLogId = payload.data?.workout_log_id
      if (workoutLogId) {
        try {
          const factsResponse = await fetch(`/api/workout/session-feedback?workout_log_id=${encodeURIComponent(workoutLogId)}`)
          const factsPayload = await factsResponse.json()
          if (factsResponse.ok) {
            const base: SessionFeedbackView = {
              workoutLogId,
              facts: factsPayload.data.facts,
              signals: factsPayload.data.signals ?? [],
              aiState: 'loading',
              ai: null,
              provenance: null,
              rating: factsPayload.data.feedback?.rating ?? null,
            }
            setSessionFeedback(base)

            const aiResponse = await fetch('/api/ai/compose', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ surface: 'workout_session_feedback', workout_log_id: workoutLogId }),
            })
            const aiPayload = await aiResponse.json()
            if (aiResponse.ok && aiPayload?.data?.ai) {
              setSessionFeedback(current => current ? {
                ...current,
                aiState: 'ready',
                ai: aiPayload.data.ai,
                provenance: {
                  prompt_version: aiPayload.data.prompt_version,
                  model: aiPayload.data.model,
                  input_snapshot_id: aiPayload.data.input_snapshot_id,
                  evidence_registry_version: aiPayload.data.evidence_registry_version,
                },
              } : current)
            } else {
              setSessionFeedback(current => current ? { ...current, aiState: 'failed' } : current)
            }
          }
        } catch {
          // Session completion is already durable; feedback is non-blocking.
          setSessionFeedback(current => current ? { ...current, aiState: 'failed' } : current)
        }
      }
      return true
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('session.errors.completeFailed'))
      return false
    } finally {
      setFinishing(false)
    }
  }

  /**
   * Patch B · B5: the stale-session banner's "结束并开始今天的训练". Reuses
   * the same completion endpoint and eligibility gate as the page's own
   * "结束今天训练" button — a session with nothing recorded still cannot be
   * force-closed here (workout_sessions allows at most one 'started' session
   * per user, so it must go through the normal completion path); see the PR
   * description for that gap.
   */
  async function completeSessionAndStartToday() {
    const ok = await completeSession()
    if (ok) router.push('/training/today')
  }

  async function rateSessionFeedback(rating: 'liked' | 'disliked') {
    if (!sessionFeedback?.provenance || feedbackSaving) return
    const next = sessionFeedback.rating === rating ? null : rating
    setFeedbackSaving(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: 'workout_session_feedback',
          scope: 'session',
          scope_id: sessionFeedback.workoutLogId,
          rating: next,
          ...sessionFeedback.provenance,
          output_json: sessionFeedback.ai,
        }),
      })
      if (!response.ok) throw new Error(t('session.errors.feedbackSaveFailed'))
      setSessionFeedback(current => current ? { ...current, rating: next } : current)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('session.errors.feedbackSaveFailed'))
    } finally {
      setFeedbackSaving(false)
    }
  }

  /**
   * Minimum P1 §7: shorten the threshold of an ACTIVE canonical session.
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
      if (!response.ok) throw new Error(payload?.error?.message || t('session.errors.durationFailed'))
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
          required_count: payload.data.required_exercise_count,
        },
      } : current)
      clearTrainingSessionCache(sessionId)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('session.errors.durationFailed'))
    } finally {
      setChangingDuration(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title={t('session.headerTitle')} back /><p className="p-5 text-sm text-gray-500">{t('session.restoring')}</p></div>
  }

  if (!data) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title={t('session.headerTitle')} back /><p className="p-5 text-sm text-red-500">{error || t('session.notFound')}</p></div>
  }

  const exercise = data.exercises[activeExerciseIndex]
  if (!exercise) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title={t('session.headerTitle')} back /><p className="p-5 text-sm text-gray-500">{t('session.noExercises')}</p></div>
  }

  const isCompleted = data.session.status === 'completed'
  const exerciseName = exercise.exercise?.canonical_name_zh
    ? exerciseDisplayName(exercise.exercise.canonical_name_zh, locale)
    : t('session.exerciseN', { n: exercise.order_index })
  const splitTitle = t('session.splitTitle', { split: splitLabel(data.session.split_key, null, locale) })
  const targetSummary = friendlyTargetSummary(exercise.prescription?.target_summary_zh, exercise.prescription?.sets ?? [], locale)
  const activeShape = shapeOf(exercise)
  const lastPoint = exercise.exercise_id ? data.last_points?.[exercise.exercise_id] ?? null : null
  const isTimedShape = activeShape === 'duration' || activeShape === 'distance_duration'
  const exerciseDrafts = drafts[exercise.id] ?? []
  const savedSetCount = exerciseDrafts.filter((draft) => draft.saved).length
  const isLastExercise = activeExerciseIndex === data.exercises.length - 1
  const exerciseFullyCompleted = (() => {
    return prescribedSetsAreComplete(
      exercise.sets,
      (set) => !set.is_extra,
      (set) => {
        const draft = exerciseDrafts.find((candidate) => candidate.setIndex === set.set_index)
        return draft ? draft.saved : set.status === 'completed'
      },
    )
  })()

  // Minimum P1 §13.2: exercise-count progress, derived from the same rule the
  // server enforces so the CTA never disagrees with the completion gate.
  const requiredExerciseCount = data.progress.required_exercise_count
  const completedExerciseCount = countFullyCompletedExercises(data.exercises, drafts)
  const completionUnit = data.progress.completion_count_unit
  const requiredCount = data.progress.required_count
  const completedCount = completionUnit === 'set'
    ? Object.values(drafts).flat().filter((draft) => draft.saved).length
    : completedExerciseCount
  const canComplete = !isCompleted && completedCount >= requiredCount
  const canShortenDuration = completionUnit === 'exercise'
    && data.progress.selected_session_minutes != null

  // Patch B · B5 (D1): the session that produced the 19924-minute record was
  // opened, left untouched for days, then resumed — this catches that case
  // while it is still open, instead of only fixing the number after the fact.
  const hoursSinceStarted = (Date.now() - new Date(data.session.started_at).getTime()) / 3_600_000
  const isStaleSession = !isCompleted && hoursSinceStarted > STALE_SESSION_HOURS
  const staleDaysAgo = Math.max(1, Math.round(hoursSinceStarted / 24))

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title={splitTitle} back />
      {isStaleSession && !staleBannerDismissed && (
        <div className="mx-auto max-w-2xl px-4 pt-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">{t('session.stale.title', { days: staleDaysAgo })}</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              {t('session.stale.body')}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setStaleBannerDismissed(true)}
                className="flex-1 rounded-lg border border-amber-300 bg-white py-2 text-xs font-medium text-amber-900"
              >
                {t('session.stale.keepLogging')}
              </button>
              <button
                type="button"
                onClick={completeSessionAndStartToday}
                disabled={!canComplete || finishing}
                className="flex-1 rounded-lg bg-amber-900 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                {t('session.stale.restart')}
              </button>
            </div>
            {!canComplete && (
              <p className="mt-2 text-[11px] text-amber-700">
                {completionUnit === 'set'
                  ? t('session.stale.needSet', { done: completedCount, required: requiredCount })
                  : t('session.stale.needExercises', { done: completedCount, required: requiredCount })}
              </p>
            )}
          </div>
        </div>
      )}
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>{isCompleted ? t('session.header.completed') : t('session.header.actualLog')}</span>
            <span>{t('session.header.progress', { n: activeExerciseIndex + 1, total: data.exercises.length })}</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold">{splitTitle}</h1>
          <span className="sr-only" aria-live="polite">
            {t('session.header.srProgress', { n: activeExerciseIndex + 1, total: data.exercises.length })}
          </span>
          <div className="mt-4 rounded-xl bg-white/10 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {isCompleted
                  ? t('session.header.completed')
                  : canComplete
                    ? t('session.header.goalMet')
                    : completionUnit === 'set'
                      ? t('session.header.goalSet')
                      : t('session.header.goalExercises', { n: requiredExerciseCount })}
              </span>
              <span className="shrink-0 tabular-nums">{completedCount} / {requiredCount}</span>
            </div>
            {!isCompleted && canShortenDuration && (
              <div className="mt-3">
                <p className="text-xs text-white/60">
                  {t('session.header.duration', { minutes: data.progress.selected_session_minutes ?? '-' })}
                  {data.progress.selection_source === 'mid_session_change' ? t('session.header.durationAdjusted') : ''}
                </p>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5" role="group" aria-label={t('session.header.durationAria')}>
                  {SESSION_MINUTE_OPTIONS
                    .filter((minutes) => minutes <= (data.progress.selected_session_minutes ?? minutes))
                    .map((minutes) => (
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
          <div className="mt-3 flex gap-1.5" role="group" aria-label={t('session.header.pickAria')}>
            {data.exercises.map((item, index) => (
              <button key={item.id} type="button" onClick={() => showExercise(index)}
                aria-label={t('session.header.viewAria', { n: index + 1 })}
                className={`h-1.5 flex-1 rounded-full ${index <= activeExerciseIndex ? 'bg-white' : 'bg-white/20'}`} />
            ))}
          </div>
        </header>

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

        <section key={exercise.id} className="rounded-2xl bg-white p-4" aria-labelledby={`exercise-${exercise.id}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400">{t('session.exerciseN', { n: exercise.order_index })}</p>
              <h2 id={`exercise-${exercise.id}`} className="mt-1 font-semibold text-gray-900">{exerciseName}</h2>
              {lastPoint && (
                <p className="mt-0.5 text-xs text-gray-400">
                  {formatLastTime(lastPoint, weightUnit, locale)}
                  {exercise.exercise_id && (
                    <Link href={`/training/exercises/${exercise.exercise_id}`} className="ml-2 text-gray-500 underline-offset-2 hover:underline">
                      {t('session.exercise.seeTrend')}
                    </Link>
                  )}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {t('session.exercise.setsCount', { saved: savedSetCount, total: exerciseDrafts.length })}
              </span>
              {exerciseFullyCompleted && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                  {t('session.exercise.counted')}
                </span>
              )}
            </div>
          </div>

          {targetSummary && (
            <p className="mt-1 text-sm text-gray-500">{t('session.exercise.suggestion', { summary: targetSummary })}</p>
          )}

          {!isCompleted && (
            <div className="mt-3 flex gap-2">
              {exercise.status === 'skipped' ? (
                <button type="button" onClick={() => setExerciseStatus(exercise.id, 'resume')}
                  disabled={exerciseActionId === exercise.id}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium disabled:opacity-50">
                  {t('session.exercise.resume')}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => showExercise(Math.min(activeExerciseIndex + 1, data.exercises.length - 1))}
                    disabled={isLastExercise}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium disabled:opacity-40">
                    {t('session.exercise.later')}
                  </button>
                  <button type="button" onClick={() => setExerciseStatus(exercise.id, 'skip')}
                    disabled={exerciseActionId === exercise.id || savedSetCount > 0}
                    className="rounded-lg px-3 py-2 text-sm text-gray-500 disabled:opacity-40">
                    {t('session.exercise.skip')}
                  </button>
                </>
              )}
            </div>
          )}

          {exercise.media && (
            <ExerciseMotion key={exercise.id} name={exerciseName} media={exercise.media} loading="eager" />
          )}

          {!isTimedShape && <div className="mt-4 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
            <span className="text-xs text-gray-500">{t('session.exercise.weightUnit')}</span>
            <div className="flex rounded-lg bg-white p-0.5" role="group" aria-label={t('session.exercise.weightUnit')}>
              {(['kg', 'lb'] as const).map((unit) => (
                <button key={unit} type="button" onClick={() => selectWeightUnit(unit)}
                  aria-pressed={weightUnit === unit}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${weightUnit === unit ? 'bg-black text-white' : 'text-gray-500'}`}>
                  {unit}
                </button>
              ))}
            </div>
          </div>}

          <div className="mt-4 space-y-3">
            {exerciseDrafts.length === 0 && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {t('session.exercise.noPresetSets')}
              </p>
            )}
            {exerciseDrafts.map((draft, position) => {
              const key = `${exercise.id}:${draft.setIndex}`
              return (
                <div key={draft.setIndex} className="rounded-xl border border-gray-100 p-3">
                  {(() => {
                    const planned = draft.isExtra
                      ? null
                      : exercise.prescription?.sets.find((set) => set.set_index === draft.setIndex) ?? null
                    const guidance = planned ? localizeSetGuidance(planned, describePlannedSet(planned), locale) : null
                    const timedTarget = planned ? formatTarget(planned, activeShape, locale) : null
                    return (
                      <div className="mb-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {t('session.set.title', { n: draft.setIndex })}
                            {guidance ? ` · ${guidance.label}` : draft.isExtra ? ` · ${t('session.set.extra')}` : ''}
                          </span>
                          <span className={`text-xs ${draft.pending ? 'text-amber-600' : draft.saved ? 'text-green-600' : draft.restored ? 'text-amber-600' : 'text-gray-400'}`}>
                            {draft.pending ? t('session.set.pending') : draft.saved ? t('session.set.saved') : draft.restored ? t('session.set.restored') : t('session.set.unsaved')}
                          </span>
                        </div>
                        {guidance && (guidance.target || timedTarget || guidance.effort || guidance.note) && (
                          <p className={`mt-1 text-xs leading-5 ${guidance.emphasis ? 'font-medium text-gray-900' : 'text-gray-500'}`}>
                            {[(timedTarget ?? guidance.target) && t('session.set.target', { target: timedTarget ?? guidance.target ?? '' }), timedTarget ? null : guidance.effort, guidance.note]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                      </div>
                    )
                  })()}
                  {activeShape === 'duration' ? (
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-gray-500">
                        {t('session.set.holdSeconds')}
                        <input type="number" inputMode="numeric" min="1" max="86400" step="1" value={draft.duration} disabled={isCompleted || exercise.status === 'skipped'}
                          onChange={(event) => updateDraft(exercise.id, position, 'duration', event.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                      </label>
                    </div>
                  ) : activeShape === 'distance_duration' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-gray-500">
                        {t('session.set.minutes')}
                        <input type="number" inputMode="decimal" min="0" step="0.5" value={draft.duration} disabled={isCompleted || exercise.status === 'skipped'}
                          onChange={(event) => updateDraft(exercise.id, position, 'duration', event.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                      </label>
                      <label className="text-xs text-gray-500">
                        {t('session.set.distance')}
                        <input type="number" inputMode="decimal" min="0" step="0.1" value={draft.distance} disabled={isCompleted || exercise.status === 'skipped'}
                          onChange={(event) => updateDraft(exercise.id, position, 'distance', event.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                      </label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <label className="text-xs text-gray-500">
                        {t('session.set.weight', { unit: weightUnit })}
                        <input type="number" min="0" step={weightUnit === 'lb' ? '1' : '0.5'} value={draft.weight} disabled={isCompleted || exercise.status === 'skipped'}
                          onChange={(event) => updateDraft(exercise.id, position, 'weight', event.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                      </label>
                      <label className="text-xs text-gray-500">
                        {t('session.set.reps')}
                        <input type="number" min="0" step="1" value={draft.reps} disabled={isCompleted || exercise.status === 'skipped'}
                          onChange={(event) => updateDraft(exercise.id, position, 'reps', event.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                      </label>
                      <label className="text-xs text-gray-500">
                        {t('session.set.rir')}
                        <input type="number" min="0" max="20" step="1" value={draft.rir} disabled={isCompleted || exercise.status === 'skipped'}
                          onChange={(event) => updateDraft(exercise.id, position, 'rir', event.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                      </label>
                    </div>
                  )}
                  {!isCompleted && (
                    <button type="button" onClick={() => saveSet(exercise.id, position)} disabled={savingKey === key || exercise.status === 'skipped'}
                      className="mt-3 w-full rounded-lg border border-gray-200 py-2 text-sm font-medium disabled:opacity-50">
                      {savingKey === key ? t('session.set.saving') : draft.saved ? t('session.set.update') : t('session.set.finish')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {!isCompleted && (
            <button type="button" onClick={() => { if (exercise.status === 'skipped') void setExerciseStatus(exercise.id, 'resume'); addSet(exercise.id) }} className="mt-3 text-sm font-medium text-gray-700">
              {t('session.exercise.addExtra')}
            </button>
          )}

          {exercise.tutorial_url && (
            <a href={exercise.tutorial_url} target="_blank" rel="noopener noreferrer"
              className="mt-4 block text-xs text-gray-400 underline underline-offset-2">
              {t('session.exercise.tutorial')}
            </a>
          )}
        </section>

        <nav className="grid grid-cols-2 gap-3" aria-label={t('session.nav.aria')}>
          <button type="button" onClick={() => showExercise(activeExerciseIndex - 1)}
            disabled={activeExerciseIndex === 0}
            className="rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 disabled:opacity-35">
            {t('session.nav.prev')}
          </button>
          <button type="button" onClick={() => showExercise(activeExerciseIndex + 1)}
            disabled={isLastExercise}
            className="rounded-xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-35">
            {t('session.nav.next')}
          </button>
        </nav>

        {isCompleted ? (
          <section className="rounded-2xl bg-white p-5">
            <h2 className="font-semibold text-gray-900">{t('session.done.title')}</h2>
            <p className="mt-2 text-sm text-gray-600">
              {completion && !(completion.program_day_completed ?? completion.progression_advanced)
                ? t('session.done.supplemental', { date: completion.log_date })
                : completion
                  ? completion.cycle_completed
                  ? t('session.done.cycle', { n: completion.current_cycle_number - 1 })
                    : t('session.done.next', { split: splitLabel(completion.next_split_key, null, locale) })
                  : t('session.done.saved')}
            </p>
            {sessionFeedback && (
              <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-3" aria-live="polite">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <p>{t('session.done.exercises')} <span className="font-semibold">{sessionFeedback.facts.completed_exercise_count}</span></p>
                  <p>{t('session.done.sets')} <span className="font-semibold">{sessionFeedback.facts.completed_set_count ?? t('session.done.setsIncomplete')}</span></p>
                  <p>{t('session.done.duration')} <span className="font-semibold">{sessionFeedback.facts.duration_excluded ? t('session.done.durationExcluded') : sessionFeedback.facts.duration_minutes == null ? t('session.done.notRecorded') : t('session.done.minutes', { n: sessionFeedback.facts.duration_minutes })}</span></p>
                  <p>{t('session.done.volume')} <span className="font-semibold">{sessionFeedback.facts.total_volume_kg == null ? t('session.done.volumeUnknown') : `${Math.round(sessionFeedback.facts.total_volume_kg * 10) / 10} kg`}</span></p>
                </div>
                {/* spec A0-5: the shared CoachCard, so this Coach block looks
                    and behaves the same as Home / History / meal feedback. */}
                <CoachCard
                  state={sessionFeedback.aiState === 'ready' ? 'ai' : sessionFeedback.aiState === 'failed' ? 'basic' : 'loading'}
                  headline={sessionFeedback.ai?.summary}
                  bullets={sessionFeedback.ai?.observations.map((item) => item.text) ?? []}
                  actions={sessionFeedback.ai?.next_actions.map((item) => item.text) ?? []}
                >
                  {/* Patch B · B2: dropped the "依据：…" provenance line — it
                      was engineering-facing clutter, not useful to a user. */}
                  {sessionFeedback.aiState === 'failed' && sessionFeedback.signals.map((signal) => (
                    <div key={signal.signal_key} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs">
                      <p>{signal.text}</p>
                    </div>
                  ))}
                  {sessionFeedback.ai && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                      <span>{t('session.done.helpful')}</span>
                      <button type="button" disabled={feedbackSaving} onClick={() => rateSessionFeedback('liked')}
                        className={sessionFeedback.rating === 'liked' ? 'opacity-100' : 'opacity-40'}>👍</button>
                      <button type="button" disabled={feedbackSaving} onClick={() => rateSessionFeedback('disliked')}
                        className={sessionFeedback.rating === 'disliked' ? 'opacity-100' : 'opacity-40'}>👎</button>
                    </div>
                  )}
                </CoachCard>
              </div>
            )}
            <button type="button" onClick={() => router.push('/training/today')}
              className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-semibold text-white">
              {t('session.done.viewPlan')}
            </button>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-4">
            {canComplete ? (
              <>
                <p className="text-sm font-medium text-gray-900">{t('session.footer.goalMet')}</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  {t('session.footer.goalMetBody')}
                </p>
                <button type="button" onClick={completeSession} disabled={finishing || savingKey !== ''}
                  className="mt-3 w-full rounded-xl bg-black py-3.5 text-sm font-semibold text-white disabled:opacity-50">
                  {finishing ? t('session.footer.finishing') : t('session.footer.finishToday')}
                </button>
              </>
            ) : (
              <p className="text-xs leading-5 text-gray-500">
                {completionUnit === 'set'
                  ? t('session.footer.needSet', { done: completedCount, required: requiredCount })
                  : t('session.footer.needExercises', { done: completedExerciseCount, required: requiredExerciseCount })}
                {t('session.footer.kept')}
              </p>
            )}
            <button type="button" onClick={() => router.push('/training/today')}
              className="mt-2 w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-700">
              {t('session.footer.later')}
            </button>
            {!canComplete && (
              <button type="button" onClick={() => setConfirmEnd(true)}
                className="mt-1 w-full rounded-xl py-3 text-sm text-gray-500">
                {t('session.footer.end')}
              </button>
            )}
            {!isLastExercise && (
              <p className="mt-3 text-center text-xs text-gray-400">
                {t('session.footer.preparing')}
              </p>
            )}
          </section>
        )}
      </main>

      {confirmEnd && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h2 id="end-title" className="text-base font-semibold text-gray-900">{t('session.confirm.title')}</h2>
            <ul className="mt-3 space-y-1.5 text-sm leading-6 text-gray-700">
              <li>• {t('session.confirm.kept')}</li>
              <li>• {t('session.confirm.notDone')}</li>
            </ul>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setConfirmEnd(false)} disabled={endingEarly}
                className="rounded-xl border border-gray-200 py-3 text-sm text-gray-700 disabled:opacity-50">
                {t('session.confirm.keepTraining')}
              </button>
              <button type="button" onClick={endEarly} disabled={endingEarly}
                className="rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50">
                {endingEarly ? t('session.confirm.ending') : t('session.confirm.end')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
