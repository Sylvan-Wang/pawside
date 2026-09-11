'use client'

import PageHeader from '@/components/PageHeader'
import ExerciseMotion from '@/components/workout/ExerciseMotion'
import type { ExerciseMedia } from '@/lib/exercise-media'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

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
}

interface TrainingSession {
  id: string
  split_key: 'push' | 'pull' | 'legs'
  status: 'started' | 'completed'
  started_at: string
  completed_at: string | null
}

interface SessionResponse {
  session: TrainingSession
  exercises: ExerciseExecution[]
}

interface SetDraft {
  setIndex: number
  weight: string
  reps: string
  rir: string
  saved: boolean
  isExtra: boolean
}

interface CompletionResult {
  next_split_key: 'push' | 'pull' | 'legs'
  current_cycle_number: number
  cycle_completed: boolean
}

const splitNames = { push: '推', pull: '拉', legs: '腿' }

function initialDrafts(exercise: ExerciseExecution): SetDraft[] {
  if (exercise.sets.length > 0) {
    return [...exercise.sets]
      .sort((a, b) => a.set_index - b.set_index)
      .map((set) => ({
        setIndex: set.set_index,
        weight: set.actual_weight_kg == null ? '' : String(set.actual_weight_kg),
        reps: set.actual_reps == null ? '' : String(set.actual_reps),
        rir: set.actual_rir == null ? '' : String(set.actual_rir),
        saved: set.status === 'completed',
        isExtra: set.is_extra,
      }))
  }

  const planned = exercise.prescription?.sets ?? []
  if (planned.length > 0) {
    return [...planned]
      .sort((a, b) => a.set_index - b.set_index)
      .map((set) => ({
        setIndex: set.set_index,
        weight: set.target_weight_kg == null ? '' : String(set.target_weight_kg),
        reps: '',
        rir: '',
        saved: false,
        isExtra: false,
      }))
  }

  return [{ setIndex: 1, weight: '', reps: '', rir: '', saved: false, isExtra: true }]
}

export default function TrainingSessionPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId
  const [data, setData] = useState<SessionResponse | null>(null)
  const [drafts, setDrafts] = useState<Record<string, SetDraft[]>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState('')
  const [completion, setCompletion] = useState<CompletionResult | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await fetch(`/api/training/sessions/${sessionId}`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message || '暂时无法读取训练')
        if (!active) return
        const nextData = payload.data as SessionResponse
        setData(nextData)
        setDrafts(Object.fromEntries(nextData.exercises.map((exercise) => [exercise.id, initialDrafts(exercise)])))
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : '暂时无法读取训练')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [sessionId])

  function updateDraft(executionId: string, position: number, field: 'weight' | 'reps' | 'rir', value: string) {
    setDrafts((current) => ({
      ...current,
      [executionId]: current[executionId].map((draft, index) => (
        index === position ? { ...draft, [field]: value, saved: false } : draft
      )),
    }))
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
          reps: '',
          rir: '',
          saved: false,
          isExtra: true,
        }],
      }
    })
  }

  async function saveSet(executionId: string, position: number) {
    const draft = drafts[executionId][position]
    const reps = Number(draft.reps)
    if (draft.reps === '' || !Number.isInteger(reps) || reps < 0) {
      setError('请填写这一组实际完成的次数')
      return
    }

    const key = `${executionId}:${draft.setIndex}`
    setSavingKey(key)
    setError('')
    try {
      const response = await fetch(`/api/training/sessions/${sessionId}/sets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exercise_execution_id: executionId,
          set_index: draft.setIndex,
          actual_weight_kg: draft.weight === '' ? null : Number(draft.weight),
          actual_reps: reps,
          actual_rir: draft.rir === '' ? null : Number(draft.rir),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || '保存失败')
      setDrafts((current) => ({
        ...current,
        [executionId]: current[executionId].map((item, index) => (
          index === position ? { ...item, saved: true } : item
        )),
      }))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSavingKey('')
    }
  }

  async function completeSession() {
    setFinishing(true)
    setError('')
    try {
      const response = await fetch(`/api/training/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || '暂时无法完成训练')
      setCompletion(payload.data)
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

  if (loading) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title="训练中" back /><p className="p-5 text-sm text-gray-500">正在恢复训练记录…</p></div>
  }

  if (!data) {
    return <div className="min-h-screen bg-gray-50"><PageHeader title="训练中" back /><p className="p-5 text-sm text-red-500">{error || '训练记录不存在'}</p></div>
  }

  const isCompleted = data.session.status === 'completed'

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title={`${splitNames[data.session.split_key]}训练`} back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <p className="text-xs text-white/60">{isCompleted ? '本次训练已完成' : '实际训练记录'}</p>
          <h1 className="mt-1 text-xl font-semibold">{splitNames[data.session.split_key]}训练</h1>
          <p className="mt-2 text-sm text-white/70">计划与实际分开保存。重量可调整，完成事实不会覆盖方法要求。</p>
        </header>

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {data.exercises.map((exercise) => {
          const exerciseName = exercise.exercise?.canonical_name_zh || `动作 ${exercise.order_index}`
          return (
            <section key={exercise.id} className="rounded-2xl bg-white p-4">
              <p className="text-xs text-gray-400">动作 {exercise.order_index}</p>
              <h2 className="mt-1 font-semibold text-gray-900">{exerciseName}</h2>
              {exercise.prescription?.target_summary_zh && (
                <p className="mt-1 text-sm text-gray-500">今天建议：{exercise.prescription.target_summary_zh}</p>
              )}

              {exercise.media && <ExerciseMotion name={exerciseName} media={exercise.media} />}

              <div className="mt-4 space-y-3">
                {(drafts[exercise.id] ?? []).map((draft, position) => {
                  const key = `${exercise.id}:${draft.setIndex}`
                  return (
                    <div key={draft.setIndex} className="rounded-xl border border-gray-100 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">第 {draft.setIndex} 组{draft.isExtra ? ' · 实际记录' : ''}</span>
                        <span className={`text-xs ${draft.saved ? 'text-green-600' : 'text-gray-400'}`}>
                          {draft.saved ? '已保存' : '待保存'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-xs text-gray-500">
                          重量 kg
                          <input type="number" min="0" step="0.5" value={draft.weight} disabled={isCompleted}
                            onChange={(event) => updateDraft(exercise.id, position, 'weight', event.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                        </label>
                        <label className="text-xs text-gray-500">
                          实际次数
                          <input type="number" min="0" step="1" value={draft.reps} disabled={isCompleted}
                            onChange={(event) => updateDraft(exercise.id, position, 'reps', event.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                        </label>
                        <label className="text-xs text-gray-500">
                          还能再做
                          <input type="number" min="0" max="20" step="1" value={draft.rir} disabled={isCompleted}
                            onChange={(event) => updateDraft(exercise.id, position, 'rir', event.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-gray-900 outline-none focus:border-gray-500 disabled:bg-gray-50" />
                        </label>
                      </div>
                      {!isCompleted && (
                        <button type="button" onClick={() => saveSet(exercise.id, position)} disabled={savingKey === key}
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
          )
        })}

        {isCompleted ? (
          <section className="rounded-2xl bg-white p-5">
            <h2 className="font-semibold text-gray-900">训练完成</h2>
            <p className="mt-2 text-sm text-gray-600">
              {completion
                ? completion.cycle_completed
                  ? `第 ${completion.current_cycle_number - 1} 轮已完成，下一次从推训练开始。`
                  : `下一次继续${splitNames[completion.next_split_key]}训练。`
                : '本次实际训练已经保存。'}
            </p>
            <button type="button" onClick={() => router.push('/training/today')}
              className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-semibold text-white">
              查看下一次训练
            </button>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-4">
            <p className="text-xs leading-5 text-gray-500">结束训练时，已保存的组会进入训练历史；未记录的动作会保留为跳过，不会被伪装成已完成。</p>
            <button type="button" onClick={completeSession} disabled={finishing || savingKey !== ''}
              className="mt-3 w-full rounded-xl bg-black py-3.5 text-sm font-semibold text-white disabled:opacity-50">
              {finishing ? '正在完成…' : '完成本次训练'}
            </button>
          </section>
        )}
      </main>
    </div>
  )
}
