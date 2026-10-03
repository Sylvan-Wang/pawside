'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { invalidateDayDerivedCache, today } from '@/lib/utils'
import CoachCard, { type CoachCardState } from '@/components/CoachCard'
import DailyWorkoutCardView from '@/components/history/DailyWorkoutCard'
import DailyMealCard from '@/components/history/DailyMealCard'
import type { DailyWorkoutCard } from '@/lib/history/daily-workout-card'
import type { MealBoard } from '@/lib/nutrition/meal-board'
interface WorkoutLog {
  id: string
  type: string
  duration_minutes: number
  notes: string | null
  exercises: { name: string; sets?: number; reps?: string; weight?: number }[] | null
  method_workout_session_id: string | null
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
  input_snapshot_id?: string | null
  ai_status?: { available: boolean; reason: string | null; detail: string | null }
}

interface BodyMetric {
  id: string
  weight_kg: number | null
  body_fat_pct: number | null
  muscle_mass: number | null
  notes: string | null
}

interface NutritionCardData {
  consumed: { calories_kcal: number | null; protein_g: number | null }
  target: { calories_kcal: number | null; protein_g: number | null }
  remaining: { calories_kcal: number | null; protein_g: number | null } | null
}

export default function HistoryDetailPage() {
  const { date } = useParams<{ date: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([])
  const [foods, setFoods] = useState<FoodLog[]>([])
  const [metric, setMetric] = useState<BodyMetric | null>(null)
  const [workoutCards, setWorkoutCards] = useState<DailyWorkoutCard[]>([])
  const [mealBoard, setMealBoard] = useState<MealBoard | null>(null)
  const [nutrition, setNutrition] = useState<NutritionCardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'workout' | 'food' | 'metric'; id: string } | null>(null)
  const [aiReview, setAiReview] = useState<AIReview | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(false)
  const [feedbackSaving, setFeedbackSaving] = useState(false)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/auth'); return }

    const [wRes, fRes, mRes, dailyResponse] = await Promise.all([
      supabase.from('workout_logs').select('*').eq('user_id', user.id).eq('date', date),
      supabase.from('food_logs').select('*').eq('user_id', user.id).eq('date', date),
      supabase.from('body_metrics').select('id,weight_kg,body_fat_pct,muscle_mass,notes').eq('user_id', user.id).eq('date', date).maybeSingle(),
      fetch(`/api/daily-log?date=${encodeURIComponent(date)}&today=${encodeURIComponent(today())}`, { cache: 'no-store' }),
    ])
    setWorkouts(wRes.data || [])
    setFoods(fRes.data || [])
    setMetric(mRes.data)
    if (dailyResponse.ok) {
      const payload = await dailyResponse.json()
      setWorkoutCards(payload?.data?.workout_cards ?? [])
      setMealBoard(payload?.data?.meal_board ?? null)
      setNutrition(payload?.data?.nutrition ?? null)
    }
    setLoading(false)
  }, [date, router, supabase])

  // Trigger AI review — sessionStorage cache per date so revisiting is instant
  const triggerAIReview = useCallback(async (forceRefresh = false) => {
    const cacheKey = `ai_review_v3_${date}`

    if (!forceRefresh && typeof window !== 'undefined') {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try { setAiReview(JSON.parse(cached)); return } catch { /* ignore */ }
      }
    }

    setAiLoading(true)
    setAiError(false)
    try {
      const res = await fetch('/api/ai/daily-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setAiReview(data)
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(cacheKey, JSON.stringify(data))
      }
    } catch {
      setAiError(true)
    } finally {
      setAiLoading(false)
    }
  }, [date])

  useEffect(() => { void Promise.resolve().then(load) }, [load])
  useEffect(() => {
    if (!loading) void Promise.resolve().then(() => triggerAIReview())
  }, [loading, triggerAIReview])

  async function handleDelete() {
    if (!confirmDelete) return
    const { type, id } = confirmDelete
    setConfirmDelete(null)

    let error = null
    if (type === 'workout') {
      ;({ error } = await supabase.from('workout_logs').delete().eq('id', id))
    } else if (type === 'food') {
      const response = await fetch(`/api/nutrition/food-log/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        error = { message: payload?.error?.message || '删除失败' }
      }
    } else if (type === 'metric') {
      ;({ error } = await supabase.from('body_metrics').delete().eq('id', id))
    }

    if (error) {
      show('删除失败', 'error')
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await invalidateDayDerivedCache(supabase, user.id, date)
      // Clear sessionStorage so next visit regenerates
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(`ai_review_${date}`)
        sessionStorage.removeItem(`ai_review_v3_${date}`)
      }
      show('操作成功')
      load()
      setAiReview(null)
      triggerAIReview(true) // force refresh
    }
  }

  async function handleFeedback(feedback: 'liked' | 'disliked') {
    if (feedbackSaving || !aiReview) return
    const next = aiReview.feedback === feedback ? null : feedback
    setAiReview(r => r ? { ...r, feedback: next } : r)
    setFeedbackSaving(true)
    const response = await fetch('/api/ai/daily-review', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, feedback: next }),
    })
    if (!response.ok) {
      setAiReview(r => r ? { ...r, feedback: aiReview.feedback ?? null } : r)
      show('当前复盘缺少可追溯信息，暂不能评价', 'error')
    }
    setFeedbackSaving(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">加载中…</p>
    </div>
  )

  const normalizedSessionIds = new Set(workoutCards.map((card) => card.session_id))
  const legacyOnlyWorkouts = workouts.filter((workout) => !workout.method_workout_session_id || !normalizedSessionIds.has(workout.method_workout_session_id))
  const hasCanonicalMeals = mealBoard ? Object.values(mealBoard).some((meal) => meal.items.length > 0) : false

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

        {/* B9: normalized Method facts; free/legacy workouts retain their existing card. */}
        {workoutCards.map((card) => <DailyWorkoutCardView key={card.session_id} card={card} />)}
        {legacyOnlyWorkouts.length > 0 && <div className="bg-white rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-3">训练记录</h2>
          {legacyOnlyWorkouts.map(w => (
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
            ))}
        </div>}
        {workoutCards.length === 0 && legacyOnlyWorkouts.length === 0 && (
          <div className="rounded-2xl bg-white p-4 text-sm text-gray-400">暂无训练记录</div>
        )}

        {/* B10: same canonical meal-type merge used by the B1 food page. */}
        {mealBoard && nutrition && (hasCanonicalMeals || foods.length === 0) && (
          <DailyMealCard date={date} board={mealBoard} consumed={nutrition.consumed} target={nutrition.target} remaining={nutrition.remaining} />
        )}
        {!hasCanonicalMeals && foods.length > 0 && <div className="bg-white rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-3">饮食记录</h2>
          {foods.map(f => (
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
            ))}
        </div>}

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
            {aiReview?.input_snapshot_id && !aiLoading && (
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
              <button onClick={() => triggerAIReview()}
                className="text-xs text-black border border-gray-200 px-3 py-1.5 rounded-lg">
                重试
              </button>
            </div>
          )}

          {aiReview && !aiLoading && (
            <div className="space-y-3">
              <CoachCard
                state={(() => {
                  if (workouts.length === 0 && foods.length === 0 && !metric) return 'insufficient'
                  return aiReview.ai_status?.available ? 'ai' : 'basic'
                })() as CoachCardState}
                headline={aiReview.summary}
                bullets={aiReview.insights}
                actions={aiReview.actions}
                dataQualityTip={aiReview.data_quality_tip || null}
                onRetry={() => triggerAIReview(true)}
                insufficientText="这一天还没有记录，没有内容可以复盘。"
              />
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
