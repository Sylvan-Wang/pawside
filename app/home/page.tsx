'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BottomNav from '@/components/BottomNav'
import { today, getWeekStart } from '@/lib/utils'
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from 'recharts'

interface Profile {
  goal: string
  weekly_workout_target: number
  daily_calorie_target: number
  weight_kg: number
}

const POPUP_SESSION_KEY = 'pawside_popup_closed'

export default function HomePage() {
  const router = useRouter()
  const supabase = createClient()
  // 每次 mount 检查 sessionStorage，本次 session 关过就不弹
  const [showPopup, setShowPopup] = useState(() => {
    if (typeof window === 'undefined') return false
    return sessionStorage.getItem(POPUP_SESSION_KEY) !== '1'
  })
  const [profile, setProfile] = useState<Profile | null>(null)
  const [todayWorkouts, setTodayWorkouts] = useState<{ type: string; duration_minutes: number }[]>([])
  const [todayFoods, setTodayFoods] = useState<{ meal_type: string; foods: { calories?: number }[] }[]>([])
  const [streak, setStreak] = useState(0)
  const [weeklyDone, setWeeklyDone] = useState(0)
  const [weightData, setWeightData] = useState<{ date: string; weight: number }[]>([])
  const [currentWeight, setCurrentWeight] = useState<number | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)

  function closePopup() {
    sessionStorage.setItem(POPUP_SESSION_KEY, '1')
    setShowPopup(false)
  }

  const load = useCallback(async () => {
    // getSession reads from localStorage — no network call
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/auth'); return }

    const todayStr = today()
    const weekStart = getWeekStart(new Date()).toISOString().split('T')[0]
    // 查近 60 天用于计算 streak
    const sixtyDaysAgo = new Date()
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
    const streakFrom = sixtyDaysAgo.toISOString().split('T')[0]

    const [profileRes, workoutRes, foodRes, weekWorkoutRes, metricsRes, streakWRes, streakFRes] = await Promise.all([
      supabase.from('user_profiles').select('goal,weekly_workout_target,daily_calorie_target,weight_kg').eq('id', user.id).single(),
      supabase.from('workout_logs').select('type,duration_minutes').eq('user_id', user.id).eq('date', todayStr),
      supabase.from('food_logs').select('meal_type,foods').eq('user_id', user.id).eq('date', todayStr),
      supabase.from('workout_logs').select('date').eq('user_id', user.id).gte('date', weekStart),
      supabase.from('body_metrics').select('date,weight_kg').eq('user_id', user.id).order('date', { ascending: false }).limit(14),
      supabase.from('workout_logs').select('date').eq('user_id', user.id).gte('date', streakFrom),
      supabase.from('food_logs').select('date').eq('user_id', user.id).gte('date', streakFrom),
    ])

    const p = profileRes.data
    setProfile(p)
    setTodayWorkouts(workoutRes.data || [])
    setTodayFoods(foodRes.data || [])
    setWeeklyDone((weekWorkoutRes.data || []).length)

    const metrics = metricsRes.data || []
    const withWeight = metrics.filter(m => m.weight_kg).reverse()
    setWeightData(withWeight.map(m => ({ date: m.date.slice(5), weight: m.weight_kg })))
    if (withWeight.length > 0) setCurrentWeight(withWeight[withWeight.length - 1].weight_kg)

    // Streak：本地计算，从今天往前数连续有记录的天数
    const activeDates = new Set<string>([
      ...(streakWRes.data || []).map((r: { date: string }) => r.date),
      ...(streakFRes.data || []).map((r: { date: string }) => r.date),
    ])
    let s = 0
    const d = new Date()
    for (let i = 0; i < 61; i++) {
      const ds = d.toISOString().split('T')[0]
      if (activeDates.has(ds)) {
        s++
      } else if (i > 0) {
        // 今天可以还没有记录，不算断
        break
      }
      d.setDate(d.getDate() - 1)
    }
    setStreak(s)
  }, [router, supabase])

  // Load AI summary — sessionStorage cache so revisiting /home is instant
  const loadAiSummary = useCallback(async () => {
    const dateKey = today()
    const cacheKey = `ai_summary_${dateKey}`

    // Check sessionStorage first (same session, same day)
    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) { setAiSummary(cached); return }
    }

    setAiSummaryLoading(true)
    try {
      const res = await fetch('/api/ai/daily-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateKey }),
      })
      if (res.ok) {
        const data = await res.json()
        const summary = data.summary || null
        setAiSummary(summary)
        if (summary && typeof window !== 'undefined') {
          sessionStorage.setItem(cacheKey, summary)
        }
      }
    } catch { /* silent */ } finally {
      setAiSummaryLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadAiSummary() }, [loadAiSummary])

  const weekTarget = profile?.weekly_workout_target || 3
  const weekPct = Math.min(100, Math.round((weeklyDone / weekTarget) * 100))

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* Popup */}
      {showPopup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
          <div className="bg-white w-full rounded-t-2xl p-6">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-base font-semibold">今天想做什么？</h2>
              <button onClick={closePopup} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => router.push('/workout')}
                className="bg-black text-white rounded-xl py-4 text-sm font-medium">
                记录训练
              </button>
              <button onClick={() => router.push('/food')}
                className="border border-gray-200 rounded-xl py-4 text-sm text-gray-700">
                记录饮食
              </button>
            </div>
            <button onClick={closePopup} className="w-full mt-3 py-3 text-sm text-gray-400">
              关闭
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white px-4 py-4 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-gray-400">{today()}</p>
            <h1 className="text-lg font-bold text-gray-900">爪边</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/workout')}
              className="text-xs bg-black text-white px-3 py-1.5 rounded-lg">记录训练</button>
            <button onClick={() => router.push('/food')}
              className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg text-gray-700">记录饮食</button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Dashboard cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4">
            <p className="text-xs text-gray-400 mb-1">今日训练进度</p>
            <p className={`text-sm font-semibold ${todayWorkouts.length > 0 ? 'text-black' : 'text-gray-400'}`}>
              {todayWorkouts.length > 0 ? `已完成 ${todayWorkouts.length} 次` : '未完成'}
            </p>
            {todayWorkouts.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">{todayWorkouts.map(w => w.type).join('、')}</p>
            )}
          </div>
          <div className="bg-white rounded-2xl p-4">
            <p className="text-xs text-gray-400 mb-1">今日饮食进度</p>
            <p className={`text-sm font-semibold ${todayFoods.length > 0 ? 'text-black' : 'text-gray-400'}`}>
              {todayFoods.length > 0 ? `已记录 ${todayFoods.length} 餐` : '未记录'}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <p className="text-xs text-gray-400 mb-1">本周完成度</p>
            <p className="text-sm font-semibold">{weeklyDone} / {weekTarget} 次</p>
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-black rounded-full transition-all" style={{ width: `${weekPct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{weekPct}%</p>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <p className="text-xs text-gray-400 mb-1">连续打卡</p>
            <p className="text-sm font-semibold">{streak} 天</p>
          </div>
        </div>

        {/* Today AI summary */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">今日复盘</h2>
            <button onClick={() => router.push(`/history/${today()}`)}
              className="text-xs text-gray-400 underline">查看详情</button>
          </div>
          {aiSummaryLoading
            ? <p className="text-sm text-gray-400">AI 分析中…</p>
            : aiSummary
              ? <p className="text-sm text-gray-700 leading-relaxed">{aiSummary}</p>
              : <p className="text-sm text-gray-400">暂无数据，去记录今天的第一条吧～</p>
          }
        </div>

        {/* Weight trend */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold">体重趋势</h2>
            {currentWeight && <p className="text-sm font-bold">{currentWeight} kg</p>}
          </div>
          {weightData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={weightData}>
                <XAxis dataKey="date" hide />
                <Tooltip
                  formatter={(v: number) => [`${v} kg`, '']}
                  labelFormatter={() => ''}
                  contentStyle={{ fontSize: 12, border: 'none', background: '#f5f5f5', borderRadius: 8 }}
                />
                <Line type="monotone" dataKey="weight" stroke="#000" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400">暂无数据</p>
              <button onClick={() => router.push('/body-metrics')} className="mt-2 text-xs text-black underline">
                记录身体数据
              </button>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-3">快捷入口</h2>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '记录训练', href: '/workout', icon: '🏋️' },
              { label: '记录饮食', href: '/food', icon: '🥗' },
              { label: '记录身体', href: '/body-metrics', icon: '📏' },
            ].map(({ label, href, icon }) => (
              <button key={href} onClick={() => router.push(href)}
                className="flex flex-col items-center py-3 border border-gray-100 rounded-xl text-xs text-gray-600">
                <span className="text-xl mb-1">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
