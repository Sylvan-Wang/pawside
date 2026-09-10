'use client'

import PageHeader from '@/components/PageHeader'
import ExerciseMotion from '@/components/workout/ExerciseMotion'
import type { ExerciseMedia } from '@/lib/exercise-media'
import { useEffect, useState } from 'react'

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
  split_key: 'push' | 'pull' | 'legs'
  status: string
  method_split: { name_zh: string } | null
  exercises: ExercisePrescription[]
}

const setTypeNames: Record<string, string> = {
  warmup: '热身',
  working: '正式',
  failure: '力竭',
  rest_pause: '暂停组',
  backoff: '降重',
  other: '其他',
}

export default function TodayTrainingPage() {
  const [training, setTraining] = useState<TodayTraining | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await fetch('/api/training/today', { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message || '暂时无法读取今天的训练')
        if (active) setTraining(payload.data.prescription)
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : '加载失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="今天的训练" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {loading && <p className="rounded-2xl bg-white p-5 text-sm text-gray-500">正在读取训练要求…</p>}
        {!loading && error && <p className="rounded-2xl bg-white p-5 text-sm text-gray-600">{error}</p>}

        {training && (
          <>
            <header className="rounded-2xl bg-black p-5 text-white">
              <p className="text-xs text-white/60">今日处方</p>
              <h1 className="mt-1 text-xl font-semibold">{training.method_split?.name_zh || training.split_key}</h1>
              <p className="mt-2 text-sm text-white/70">每个动作均显示固定版本素材与许可证状态。</p>
            </header>

            {training.exercises.map((item) => {
              const exerciseName = item.exercise?.canonical_name_zh || `动作 ${item.order_index}`
              return (
                <section key={item.id} className="rounded-2xl bg-white p-4">
                  <p className="text-xs text-gray-400">动作 {item.order_index}</p>
                  <h2 className="mt-1 font-semibold text-gray-900">{exerciseName}</h2>
                  {item.target_summary_zh && <p className="mt-1 text-sm text-gray-500">{item.target_summary_zh}</p>}

                  {item.media ? (
                    <ExerciseMotion name={exerciseName} media={item.media} />
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
