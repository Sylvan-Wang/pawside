'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
interface WorkoutLog {
  id: string
  type: string
  duration_minutes: number
  notes: string | null
  exercises: { name: string; sets?: number; reps?: string; weight?: number }[] | null
}

interface FoodLog {
  id: string
  meal_type: string
  foods: { name: string; weight?: number; weight_g?: number; calories?: number; protein_g?: number }[]
}

interface AIReview {
  summary: string
  insights: string[]
  actions: string[]
  data_quality_tip: string
  tone: string
  cached: boolean
  feedback?: string | null
}

interface BodyMetric {
  id: string
  weight_kg: number | null
  body_fat_pct: number | null
  muscle_mass: number | null
  notes: string | null
}

export default function HistoryDetailPage() {
  const { date } = useParams<{ date: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([])
  const [foods, setFoods] = useState<FoodLog[]>([])
  const [metric, setMetric] = useState<BodyMetric | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'workout' | 'food' | 'metric'; id: string } | null>(null)
  const [aiReview, setAiReview] = useState<AIReview | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(false)
  const [feedbackSaving, setFeedbackSaving] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }

    const [wRes, fRes, mRes] = await Promise.all([
      supabase.from('workout_logs').select('*').eq('user_id', user.id).eq('date', date),
      supabase.from('food_logs').select('*').eq('user_id', user.id).eq('date', date),
      supabase.from('body_metrics').select('id,weight_kg,body_fat_pct,muscle_mass,notes').eq('user_id', user.id).eq('date', date).maybeSingle(),
    ])
    setWorkouts(wRes.data || [])
    setFoods(fRes.data || [])
    setMetric(mRes.data)
    setLoading(false)
  }, [date, router, supabase])

  // Trigger AI review after data loads
  const triggerAIReview = useCallback(async () => {
    setAiLoading(true)
    setAiError(false)
    try {
      const res = await fetch('/api/ai/daily-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setAiReview(data)
    } catch {
      setAiError(true)
    } finally {
      setAiLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (!loading) triggerAIReview() }, [loading, triggerAIReview])

  async function handleDelete() {
    if (!confirmDelete) return
    const { type, id } = confirmDelete
    setConfirmDelete(null)

    let error = null
    if (type === 'workout') {
      ;({ error } = await supabase.from('workout_logs').delete().eq('id', id))
    } else if (type === 'food') {
      ;({ error } = await supabase.from('food_logs').delete().eq('id', id))
    } else if (type === 'metric') {
      ;({ error } = await supabase.from('body_metrics').delete().eq('id', id))
    }

    if (error) {
      show('删除失败', 'error')
    } else {
      show('操作成功')
      load()
    }
  }

  async function handleFeedback(feedback: 'liked' | 'disliked') {
    if (feedbackSaving || !aiReview) return
    const next = aiReview.feedback === feedback ? null : feedback
    setAiReview(r => r ? { ...r, feedback: next } : r)
    setFeedbackSaving(true)
    await fetch('/api/ai/daily-review', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, feedback: next }),
    })
    setFeedbackSaving(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">加载中…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {ToastEl}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs">
            <p className="text-sm font-semibold mb-2">确认删除？</p>
            <p className="text-xs text-gray-400 mb-5">删除后无法恢复</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600">
                取消
              </button>
              <button onClick={handleDelete}
                className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-medium">
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <PageHeader title="当日记录" back />

      <div className="px-4 py-4 space-y-4">
        <p className="text-xs text-gray-400">{date}</p>

        {/* Workout */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-3">训练记录</h2>
          {workouts.length === 0
            ? <p className="text-sm text-gray-400">暂无训练记录</p>
            : workouts.map(w => (
              <div key={w.id} className="mb-4 last:mb-0 pb-4 last:pb-0 border-b last:border-0 border-gray-50">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{w.type}</span>
                      <span className="text-xs text-gray-400">{w.duration_minutes} 分钟</span>
                    </div>
                    {w.notes && <p className="text-xs text-gray-400 mt-0.5">{w.notes}</p>}
                    {w.exercises && w.exercises.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {w.exercises.map((ex, i) => (
                          <p key={i} className="text-xs text-gray-600">
                            {ex.name}{ex.sets ? ` · ${ex.sets} 组` : ''}{ex.reps ? ` × ${ex.reps}` : ''}{ex.weight ? ` · ${ex.weight} kg` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-2 flex-shrink-0">
                    <button onClick={() => router.push(`/workout/${w.id}/edit`)}
                      className="text-xs text-black border border-gray-200 px-2.5 py-1 rounded-lg">
                      编辑
                    </button>
                    <button onClick={() => setConfirmDelete({ type: 'workout', id: w.id })}
                      className="text-xs text-red-400 border border-red-100 px-2.5 py-1 rounded-lg">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          }
        </div>

        {/* Food */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-3">饮食记录</h2>
          {foods.length === 0
            ? <p className="text-sm text-gray-400">暂无饮食记录</p>
            : foods.map(f => (
              <div key={f.id} className="mb-4 last:mb-0 pb-4 last:pb-0 border-b last:border-0 border-gray-50">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-1">{f.meal_type}</p>
                    <div className="space-y-0.5">
                      {f.foods.map((item, i) => (
                        <p key={i} className="text-xs text-gray-600">
                          {item.name} {item.weight_g ?? item.weight}g
                          {item.calories ? ` · ${item.calories} kcal` : ''}
                          {item.protein_g ? ` · 蛋白质 ${item.protein_g}g` : ''}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-2 flex-shrink-0">
                    <button onClick={() => router.push(`/food/${f.id}/edit`)}
                      className="text-xs text-black border border-gray-200 px-2.5 py-1 rounded-lg">
                      编辑
                    </button>
                    <button onClick={() => setConfirmDelete({ type: 'food', id: f.id })}
                      className="text-xs text-red-400 border border-red-100 px-2.5 py-1 rounded-lg">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          }
        </div>

        {/* Body metrics */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold">身体数据</h2>
            {metric && (
              <button onClick={() => setConfirmDelete({ type: 'metric', id: metric.id })}
                className="text-xs text-red-400 border border-red-100 px-2.5 py-1 rounded-lg">
                删除
              </button>
            )}
          </div>
          {!metric
            ? <p className="text-sm text-gray-400">暂无身体数据</p>
            : (
              <div className="space-y-1 text-sm">
                {metric.weight_kg && <p>体重：<span className="font-medium">{metric.weight_kg} kg</span></p>}
                {metric.body_fat_pct && <p>体脂率：<span className="font-medium">{metric.body_fat_pct}%</span></p>}
                {metric.muscle_mass && <p>肌肉量：<span className="font-medium">{metric.muscle_mass} kg</span></p>}
                {metric.notes && <p className="text-gray-400 text-xs mt-1">{metric.notes}</p>}
              </div>
            )
          }
        </div>

        {/* AI Daily Review */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">AI 今日复盘</h2>
            {aiReview && !aiLoading && (
              <div className="flex gap-1.5">
                <button onClick={() => handleFeedback('liked')}
                  className={`text-base px-1.5 py-0.5 rounded-lg transition-colors ${aiReview.feedback === 'liked' ? 'bg-green-50' : 'opacity-40'}`}>
                  👍
                </button>
                <button onClick={() => handleFeedback('disliked')}
                  className={`text-base px-1.5 py-0.5 rounded-lg transition-colors ${aiReview.feedback === 'disliked' ? 'bg-red-50' : 'opacity-40'}`}>
                  👎
                </button>
              </div>
            )}
          </div>

          {aiLoading && (
            <div className="py-4 text-center">
              <p className="text-xs text-gray-400">AI 分析中…</p>
            </div>
          )}

          {aiError && !aiLoading && (
            <div className="py-2">
              <p className="text-xs text-gray-400 mb-2">生成失败</p>
              <button onClick={triggerAIReview}
                className="text-xs text-black border border-gray-200 px-3 py-1.5 rounded-lg">
                重试
              </button>
            </div>
          )}

          {aiReview && !aiLoading && (
            <div className="space-y-3">
              <p className="text-sm text-gray-800 leading-relaxed">{aiReview.summary}</p>

              {aiReview.insights.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5 font-medium">观察</p>
                  <div className="space-y-1.5">
                    {aiReview.insights.map((insight, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-gray-300 mt-0.5 flex-shrink-0">·</span>
                        <p className="text-xs text-gray-700 leading-relaxed">{insight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {aiReview.actions.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5 font-medium">建议</p>
                  <div className="space-y-1.5">
                    {aiReview.actions.map((action, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-gray-300 mt-0.5 flex-shrink-0">→</span>
                        <p className="text-xs text-gray-700 leading-relaxed">{action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {aiReview.data_quality_tip && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  {aiReview.data_quality_tip}
                </p>
              )}

              {aiReview.cached && (
                <p className="text-xs text-gray-300 text-right">已缓存</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
