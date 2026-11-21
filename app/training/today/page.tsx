'use client'

import PageHeader from '@/components/PageHeader'
import ExerciseMotion from '@/components/workout/ExerciseMotion'
import type { ExerciseMedia } from '@/lib/exercise-media'
import { SESSION_MINUTE_OPTIONS, type SessionMinutes } from '@/lib/training-duration'
import {
  clearTodayTrainingCache,
  readTodayTrainingCache,
  readTrainingSessionCache,
  warmTrainingSessionCache,
  writeTodayTrainingCache,
} from '@/lib/training-navigation-cache'
import { useRouter } from 'next/navigation'
import { splitLabel } from '@/lib/split-labels'
import { describeTimedTarget } from '@/lib/workout-log-summary'
import { friendlyTargetSummary } from '@/lib/training-copy'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translate, type Locale, type MessageKey } from '@/lib/i18n'
import { exerciseDisplayName } from '@/lib/i18n/exercise-names'

interface SetPrescription {
  id: string
  set_index: number
  set_type: string
  target_reps_min: number | null
  target_reps_max: number | null
  target_duration_seconds?: number | null
  target_distance_m?: number | null
  target_rpe: number | null
  target_rir: number | null
  target_weight_kg: number | null
}

interface ExercisePrescription {
  id: string
  order_index: number
  target_summary_zh: string | null
  exercise: { canonical_name_zh: string } | null
  sets: SetPrescription[]
  media: ExerciseMedia | null
}

interface TodayTraining {
  id: string
  split_key: string
  status: string
  method_split: { name_zh: string } | null
  exercises: ExercisePrescription[]
}

interface WorkoutActual {
  id: string
  status: 'started' | 'completed'
}

interface ActiveSessionRecovery {
  kind: 'active_session'
  session_id: string
  split_key: string
  session_prescription_id: string
}

interface ProgramDay {
  split_key: string
  day_index: number
  name_zh: string
  required: boolean
  status: string
  completed: boolean
  started: boolean
  available: boolean
  prescription_id: string | null
}

interface TodayTrainingPayload {
  program_day: {
    split_key: string
    day_index: number
    name_zh: string
    cycle_number: number
    prescription_id: string
  }
  days: ProgramDay[]
  next_split_key: string | null
  preferred_session_minutes: number
  current_log_date: string
  view_date: string
  prescription: TodayTraining
  workout_actual: WorkoutActual | null
  recovery: ActiveSessionRecovery | null
}

interface TrainingUnavailableState {
  kind: 'not_enrolled'
  message: string
}

const SET_TYPES = ['warmup', 'working', 'failure', 'rest_pause', 'backoff', 'other']

function setTypeName(type: string, locale: Locale) {
  return SET_TYPES.includes(type) ? translate(locale, `today.setTypes.${type}` as MessageKey) : type
}

function dayStatusLabel(day: ProgramDay, locale: Locale) {
  if (day.completed) return translate(locale, 'today.status.completed')
  if (day.started) return translate(locale, 'today.status.inProgress')
  if (!day.available) return translate(locale, 'today.status.notGenerated')
  if (day.status === 'started') return translate(locale, 'today.status.inProgress')
  return translate(locale, 'today.status.notStarted')
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function TodayTrainingPage() {
  const router = useRouter()
  const [locale] = useLocale()
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params)
  const [training, setTraining] = useState<TodayTraining | null>(null)
  const [workoutActual, setWorkoutActual] = useState<WorkoutActual | null>(null)
  const [recovery, setRecovery] = useState<ActiveSessionRecovery | null>(null)
  const [days, setDays] = useState<ProgramDay[]>([])
  const [programDay, setProgramDay] = useState<TodayTrainingPayload['program_day'] | null>(null)
  const [preferredMinutes, setPreferredMinutes] = useState<number | null>(null)
  const [selectedMinutes, setSelectedMinutes] = useState<SessionMinutes | null>(null)
  const [unavailableState, setUnavailableState] = useState<TrainingUnavailableState | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  // Program Day navigation (PRD §2.1). null means "let the server pick the
  // recommended Program Day".
  const [selectedSplit, setSelectedSplit] = useState<string | null>(null)
  const startRequestId = useRef<string | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      setTraining(null)
      setWorkoutActual(null)
      setRecovery(null)
      setUnavailableState(null)
      startRequestId.current = null

      const cached = selectedSplit
        ? readTodayTrainingCache<TodayTrainingPayload>(selectedSplit)
        : null
      if (cached) {
        setTraining(cached.prescription)
        setWorkoutActual(cached.workout_actual)
        setRecovery(cached.recovery)
        setDays(cached.days ?? [])
        setProgramDay(cached.program_day)
        setPreferredMinutes(cached.preferred_session_minutes ?? 60)
        setSelectedMinutes((current) => current
          ?? ((cached.preferred_session_minutes ?? 60) as SessionMinutes))
        setLoading(false)
        return
      }

      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        const query = new URLSearchParams({ time_zone: timeZone })
        if (selectedSplit) query.set('split', selectedSplit)
        const response = await fetch(`/api/training/today?${query}`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message || translate(locale, 'today.loadFailed'))
        if (active) {
          const data = payload.data as TodayTrainingPayload | null
          if (!data) {
            setUnavailableState(payload.state ?? {
              kind: 'not_enrolled',
              message: translate(locale, 'today.notEnrolledMessage'),
            })
            return
          }
          setTraining(data.prescription)
          setWorkoutActual(data.workout_actual)
          setRecovery(data.recovery)
          setDays(data.days ?? [])
          setProgramDay(data.program_day)
          setPreferredMinutes(data.preferred_session_minutes ?? 60)
          setSelectedMinutes((current) => current ?? ((data.preferred_session_minutes ?? 60) as SessionMinutes))
          writeTodayTrainingCache(data, data.program_day.split_key)
        }
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : translate(locale, 'today.loadFailedShort'))
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
    // locale only feeds fallback error text; switching language must not refetch the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSplit])

  useEffect(() => {
    const activeSessionId = workoutActual?.id ?? recovery?.session_id
    if (!activeSessionId) return
    const sessionUrl = `/training/sessions/${activeSessionId}`
    router.prefetch(sessionUrl)
    if (readTrainingSessionCache(activeSessionId)) return

    void warmTrainingSessionCache(activeSessionId)
      .catch(() => undefined)
  }, [recovery?.session_id, router, workoutActual?.id])

  function selectDay(split: string) {
    setSelectedSplit(split)
    window.history.replaceState(null, '', `/training/today?split=${split}`)
  }

  async function startTraining() {
    if (!training || starting) return
    const activeSessionId = workoutActual?.id ?? recovery?.session_id
    if (activeSessionId) {
      router.push(`/training/sessions/${activeSessionId}`)
      return
    }

    setStarting(true)
    setError('')
    try {
      startRequestId.current ??= window.crypto.randomUUID()
      const minutes = selectedMinutes ?? ((preferredMinutes ?? 60) as SessionMinutes)
      const response = await fetch(`/api/training/${training.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // PRD §1: the Program Day is the plan position; the calendar date is the
          // date the user is actually training. Actual attribution comes from
          // performed_at / time_zone on the server.
          view_date: localDateString(),
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          start_request_id: startRequestId.current,
          selected_session_minutes: minutes,
          selection_source: minutes === preferredMinutes ? 'profile_default' : 'user_override',
        }),
      })
      const payload = await response.json()
      if (response.status === 409 && payload?.error?.details?.session_id) {
        router.push(`/training/sessions/${payload.error.details.session_id}`)
        return
      }
      if (!response.ok) throw new Error(payload?.error?.message || t('today.startFailed'))
      const sessionId = payload.data.session_id as string
      clearTodayTrainingCache()
      const sessionUrl = `/training/sessions/${sessionId}`
      router.prefetch(sessionUrl)
      void warmTrainingSessionCache(sessionId).catch(() => undefined)
      router.push(sessionUrl)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('today.startFailed'))
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title={t('today.title')} back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {days.length > 0 && (
          <nav className={`grid gap-2 ${days.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`} aria-label={t('today.dayNavLabel')}>
            {days.map((day) => {
              const active = programDay?.split_key === day.split_key
              return (
                <button
                  key={day.split_key}
                  type="button"
                  onClick={() => selectDay(day.split_key)}
                  className={`rounded-2xl border px-3 py-3 text-left transition-colors ${
                    active ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-700'
                  }`}
                >
                  <p className="text-xs opacity-70">
                    {day.required ? t('today.dayLabel', { n: day.day_index }) : t('today.optional')} · {locale === 'en' ? splitLabel(day.split_key, day.name_zh, locale) : day.name_zh}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{dayStatusLabel(day, locale)}</p>
                </button>
              )
            })}
          </nav>
        )}

        {loading && <p className="rounded-2xl bg-white p-5 text-sm text-gray-500">{t('today.loading')}</p>}
        {!loading && error && <p className="rounded-2xl bg-white p-5 text-sm text-gray-600">{error}</p>}
        {!loading && !error && unavailableState && (
          <section className="rounded-2xl bg-white p-5">
            <h2 className="text-base font-semibold text-gray-900">{t('today.notEnrolledTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              {t('today.notEnrolledBody', {
                // The server message is Chinese; English shows its own wording.
                message: locale === 'en' ? t('today.notEnrolledMessage') : unavailableState.message,
              })}
            </p>
            <button
              type="button"
              onClick={() => router.push('/home')}
              className="mt-4 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white"
            >
              {t('today.backToEnable')}
            </button>
          </section>
        )}

        {training && (
          <>
            {recovery && !workoutActual && (
              <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {t('today.recoveryNotice', { split: splitLabel(recovery.split_key, null, locale) })}
              </aside>
            )}
            <header className="rounded-2xl bg-black p-5 text-white">
              <p className="text-xs text-white/60">
                {t('today.headerMeta', { day: programDay?.day_index ?? '-', cycle: programDay?.cycle_number ?? '-' })}
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                {locale === 'en'
                  ? splitLabel(training.split_key, programDay?.name_zh || training.method_split?.name_zh, locale)
                  : programDay?.name_zh || training.method_split?.name_zh || splitLabel(training.split_key)}
              </h1>

              {!recovery && (
                <div className="mt-4">
                  <p className="text-sm text-white/80">{t('today.howLong')}</p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {SESSION_MINUTE_OPTIONS.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => setSelectedMinutes(minutes)}
                        className={`rounded-xl py-2 text-sm font-medium ${
                          selectedMinutes === minutes
                            ? 'bg-white text-black'
                            : 'bg-white/10 text-white'
                        }`}
                      >
                        {minutes}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-white/50">{t('today.howLongNote')}</p>
                </div>
              )}

              <button
                type="button"
                onClick={startTraining}
                disabled={starting}
                className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-semibold text-black disabled:opacity-60"
              >
                {starting
                  ? t('today.starting')
                  : recovery
                    ? t('today.continueSplit', { split: splitLabel(recovery.split_key, null, locale) })
                    : t('today.start')}
              </button>
            </header>

            {training.exercises.map((item) => {
              const exerciseName = item.exercise?.canonical_name_zh
                ? exerciseDisplayName(item.exercise.canonical_name_zh, locale)
                : t('today.exerciseN', { n: item.order_index })
              const targetSummary = friendlyTargetSummary(item.target_summary_zh, item.sets, locale)
              return (
                <section key={item.id} className="rounded-2xl bg-white p-4">
                  <p className="text-xs text-gray-400">{t('today.exerciseN', { n: item.order_index })}</p>
                  <h2 className="mt-1 font-semibold text-gray-900">{exerciseName}</h2>
                  {targetSummary && <p className="mt-1 text-sm text-gray-500">{targetSummary}</p>}

                  {item.media ? (
                    <ExerciseMotion name={exerciseName} media={item.media} animate={false} loading="lazy" />
                  ) : (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('today.noMedia')}</p>
                  )}

                  {item.sets.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {item.sets.map((set) => (
                        <div key={set.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs">
                          <span>{t('today.setLine', { n: set.set_index, type: setTypeName(set.set_type, locale) })}</span>
                          <span className="text-gray-500">
                            {set.target_reps_min == null
                              ? describeTimedTarget(set, locale) ?? t('today.repsTbd')
                              : set.target_reps_max && set.target_reps_max !== set.target_reps_min
                                ? t('today.repsRange', { min: set.target_reps_min, max: set.target_reps_max })
                                : t('today.reps', { n: set.target_reps_min })}
                            {set.target_weight_kg == null ? '' : ` · ${set.target_weight_kg} kg`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </>
        )}
      </main>
    </div>
  )
}
