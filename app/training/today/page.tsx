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
import { useEffect, useRef, useState } from 'react'

interface SetPrescription {
  id: string
  set_index: number
  set_type: string
  target_reps_min: number | null
  target_reps_max: number | null
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
  split_key: 'push' | 'pull' | 'legs'
  status: string
  method_split: { name_zh: string } | null
  exercises: ExercisePrescription[]
}

interface WorkoutActual {
  id: string
  status: 'started' | 'completed'
}

interface ProgramDay {
  split_key: 'push' | 'pull' | 'legs'
  day_index: number
  name_zh: string
  status: string
  completed: boolean
  started: boolean
  available: boolean
  prescription_id: string | null
}

interface TodayTrainingPayload {
  program_day: {
    split_key: 'push' | 'pull' | 'legs'
    day_index: number
    name_zh: string
    cycle_number: number
    prescription_id: string
  }
  days: ProgramDay[]
  next_split_key: 'push' | 'pull' | 'legs' | null
  preferred_session_minutes: number
  current_log_date: string
  view_date: string
  prescription: TodayTraining
  workout_actual: WorkoutActual | null
}

const setTypeNames: Record<string, string> = {
  warmup: '热身',
  working: '正式',
  failure: '力竭',
  rest_pause: '暂停组',
  backoff: '降重',
  other: '其他',
}

function dayStatusLabel(day: ProgramDay) {
  if (day.completed) return '已完成'
  if (day.started) return '进行中'
  if (!day.available) return '未生成'
  if (day.status === 'started') return '进行中'
  return '未开始'
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function TodayTrainingPage() {
  const router = useRouter()
  const [training, setTraining] = useState<TodayTraining | null>(null)
  const [workoutActual, setWorkoutActual] = useState<WorkoutActual | null>(null)
  const [days, setDays] = useState<ProgramDay[]>([])
  const [programDay, setProgramDay] = useState<TodayTrainingPayload['program_day'] | null>(null)
  const [preferredMinutes, setPreferredMinutes] = useState<number | null>(null)
  const [selectedMinutes, setSelectedMinutes] = useState<SessionMinutes | null>(null)
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
      startRequestId.current = null

      const cached = selectedSplit
        ? readTodayTrainingCache<TodayTrainingPayload>(selectedSplit)
        : null
      if (cached) {
        setTraining(cached.prescription)
        setWorkoutActual(cached.workout_actual)
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
        if (!response.ok) throw new Error(payload?.error?.message || '暂时无法读取训练计划')
        if (active) {
          const data = payload.data as TodayTrainingPayload
          setTraining(data.prescription)
          setWorkoutActual(data.workout_actual)
          setDays(data.days ?? [])
          setProgramDay(data.program_day)
          setPreferredMinutes(data.preferred_session_minutes ?? 60)
          setSelectedMinutes((current) => current ?? ((data.preferred_session_minutes ?? 60) as SessionMinutes))
          writeTodayTrainingCache(data, data.program_day.split_key)
        }
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : '加载失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [selectedSplit])

  useEffect(() => {
    if (!workoutActual?.id) return
    const sessionUrl = `/training/sessions/${workoutActual.id}`
    router.prefetch(sessionUrl)
    if (readTrainingSessionCache(workoutActual.id)) return

    void warmTrainingSessionCache(workoutActual.id)
      .catch(() => undefined)
  }, [router, workoutActual?.id])

  function selectDay(split: string) {
    setSelectedSplit(split)
    window.history.replaceState(null, '', `/training/today?split=${split}`)
  }

  async function startTraining() {
    if (!training || starting) return
    if (workoutActual?.id) {
      router.push(`/training/sessions/${workoutActual.id}`)
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
      if (!response.ok) throw new Error(payload?.error?.message || '暂时无法开始训练')
      const sessionId = payload.data.session_id as string
      clearTodayTrainingCache()
      const sessionUrl = `/training/sessions/${sessionId}`
      router.prefetch(sessionUrl)
      void warmTrainingSessionCache(sessionId).catch(() => undefined)
      router.push(sessionUrl)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '暂时无法开始训练')
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="训练计划" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {days.length > 0 && (
          <nav className="grid grid-cols-3 gap-2" aria-label="训练日导航">
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
                  <p className="text-xs opacity-70">Day {day.day_index} · {day.name_zh}</p>
                  <p className="mt-1 text-sm font-semibold">{dayStatusLabel(day)}</p>
                </button>
              )
            })}
          </nav>
        )}

        {loading && <p className="rounded-2xl bg-white p-5 text-sm text-gray-500">正在读取训练计划…</p>}
        {!loading && error && <p className="rounded-2xl bg-white p-5 text-sm text-gray-600">{error}</p>}

        {training && (
          <>
            <header className="rounded-2xl bg-black p-5 text-white">
              <p className="text-xs text-white/60">
                Day {programDay?.day_index ?? '-'} · 第 {programDay?.cycle_number ?? '-'} 轮
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                {programDay?.name_zh || training.method_split?.name_zh || training.split_key}
              </h1>

              {!workoutActual?.id && (
                <div className="mt-4">
                  <p className="text-sm text-white/80">今天大概想练多久？</p>
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
                  <p className="mt-2 text-xs text-white/50">实际用时会受休息和器械等待影响。</p>
                </div>
              )}

              <button
                type="button"
                onClick={startTraining}
                disabled={starting}
                className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-semibold text-black disabled:opacity-60"
              >
                {starting ? '正在开始…' : workoutActual?.id ? '继续训练' : '开始这个训练日'}
              </button>
            </header>

            {training.exercises.map((item) => {
              const exerciseName = item.exercise?.canonical_name_zh || `动作 ${item.order_index}`
              return (
                <section key={item.id} className="rounded-2xl bg-white p-4">
                  <p className="text-xs text-gray-400">动作 {item.order_index}</p>
                  <h2 className="mt-1 font-semibold text-gray-900">{exerciseName}</h2>
                  {item.target_summary_zh && <p className="mt-1 text-sm text-gray-500">{item.target_summary_zh}</p>}

                  {item.media ? (
                    <ExerciseMotion name={exerciseName} media={item.media} animate={false} loading="lazy" />
                  ) : (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">此动作尚无已登记素材。</p>
                  )}

                  {item.sets.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {item.sets.map((set) => (
                        <div key={set.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs">
                          <span>第 {set.set_index} 组 · {setTypeNames[set.set_type] || set.set_type}</span>
                          <span className="text-gray-500">
                            {set.target_reps_min == null
                              ? '次数待定'
                              : set.target_reps_max && set.target_reps_max !== set.target_reps_min
                                ? `${set.target_reps_min}–${set.target_reps_max} 次`
                                : `${set.target_reps_min} 次`}
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
