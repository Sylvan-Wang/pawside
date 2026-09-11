'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import BottomNav from '@/components/BottomNav'
import { today, getWeekStart } from '@/lib/utils'
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from 'recharts'

interface Profile {
  goal: string
  weekly_workout_target: number
  daily_calorie_target: number
  weight_kg: number
  onboarding_completed: boolean
}

interface MethodContext {
  current_cycle_number: number
  next_split_key: 'push' | 'pull' | 'legs'
  current_state: 'ready' | 'recovery_check' | 'rest' | 'session_in_progress'
  method: { name: string; version: string } | null
}

interface MethodAvailability {
  status: 'active' | 'available' | 'unavailable'
  reason: string | null
  message: string | null
}

const splitNames = { push: '推', pull: '拉', legs: '腿' } as const

export default function HomePage() {
  const router = useRouter()
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [methodContext, setMethodContext] = useState<MethodContext | null>(null)
  const [methodAvailability, setMethodAvailability] = useState<MethodAvailability | null>(null)
  const [methodLoading, setMethodLoading] = useState(true)
  const [methodActivating, setMethodActivating] = useState(false)
  const [methodMessage, setMethodMessage] = useState('官方训练方法仍在规则校验中。')
  const [setupNotice, setSetupNotice] = useState('')
  const [todayWorkouts, setTodayWorkouts] = useState<{ type: string; duration_minutes: number }[]>([])
  const [todayFoods, setTodayFoods] = useState<{ meal_type: string; foods: { calories?: number }[] }[]>([])
  const [streak, setStreak] = useState(0)
  const [weeklyDone, setWeeklyDone] = useState(0)
  const [weightData, setWeightData] = useState<{ date: string; weight: number }[]>([])
  const [currentWeight, setCurrentWeight] = useState<number | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)

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
      supabase.from('user_profiles').select('goal,weekly_workout_target,daily_calorie_target,weight_kg,onboarding_completed').eq('id', user.id).single(),
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
    setProfileLoading(false)
  }, [router, supabase])

  const loadMethod = useCallback(async () => {
    setMethodLoading(true)
    try {
      const response = await fetch('/api/method/current')
      if (!response.ok) {
        setMethodContext(null)
        setMethodAvailability(null)
        setMethodMessage('暂时无法读取官方训练方法状态。')
        return
      }
      const result = await response.json()
      setMethodContext(result.data)
      setMethodAvailability(result.availability ?? null)
      if (result.availability?.message) setMethodMessage(result.availability.message)
    } catch {
      setMethodContext(null)
      setMethodAvailability(null)
      setMethodMessage('暂时无法读取官方训练方法状态。')
    } finally {
      setMethodLoading(false)
    }
  }, [])

  const handleMethodAction = useCallback(async () => {
    if (profileLoading || methodLoading || methodActivating) return
    if (!profile?.onboarding_completed) {
      router.push('/onboarding')
      return
    }
    if (methodAvailability?.status !== 'available') {
      router.push('/training/method')
      return
    }

    setMethodActivating(true)
    try {
      const response = await fetch('/api/method/enroll', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) {
        const message = result?.error?.message || result?.message || '暂时无法启用训练方法'
        setMethodMessage(message)
        if (result?.error?.code === 'ONBOARDING_INCOMPLETE') router.push('/onboarding')
        return
      }
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('pawside_setup_notice', result?.message || '三分化已启用。')
      }
      await loadMethod()
      router.push('/training/today')
    } catch {
      setMethodMessage('暂时无法启用训练方法，请稍后重试。')
    } finally {
      setMethodActivating(false)
    }
  }, [loadMethod, methodActivating, methodAvailability?.status, methodLoading, profile?.onboarding_completed, profileLoading, router])

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

  useEffect(() => { void Promise.resolve().then(load) }, [load])
  useEffect(() => { void Promise.resolve().then(loadMethod) }, [loadMethod])
  useEffect(() => { void Promise.resolve().then(loadAiSummary) }, [loadAiSummary])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const notice = sessionStorage.getItem('pawside_setup_notice')
    if (!notice) return
    sessionStorage.removeItem('pawside_setup_notice')
    const frame = window.requestAnimationFrame(() => setSetupNotice(notice))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const weekTarget = profile?.weekly_workout_target || 3
  const weekPct = Math.min(100, Math.round((weeklyDone / weekTarget) * 100))
  const entryLoading = profileLoading || methodLoading
  const methodAvailable = methodAvailability?.status === 'available'

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white px-4 py-4 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-gray-400">{today()}</p>
            <h1 className="text-lg font-bold text-gray-900">爪边</h1>
          </div>
          <div className="flex gap-2">
            <button disabled={entryLoading} onClick={() => {
              if (entryLoading) return
              router.push(
                methodContext
                  ? '/training/today'
                  : profile?.onboarding_completed
                    ? '/workout'
                    : '/onboarding'
              )
            }}
              className="text-xs bg-black text-white px-3 py-1.5 rounded-lg">
              {entryLoading
                ? '读取中…'
                : methodContext
                ? '开始今天'
                : profile?.onboarding_completed
                  ? '记录训练'
                  : '完成基础设置'}
            </button>
            <button onClick={() => router.push('/food')}
              className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg text-gray-700">记录饮食</button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {setupNotice && (
          <div className="rounded-2xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">
            {setupNotice}
          </div>
        )}
        <div className="bg-black text-white rounded-2xl p-5">
          {methodContext ? (
            <>
              <p className="text-xs text-white/60">{methodContext.method?.name || '官方三分化'} · 第 {methodContext.current_cycle_number} 轮</p>
              <div className="flex items-end justify-between mt-2">
                <div>
                  <p className="text-xl font-semibold">下一次：{splitNames[methodContext.next_split_key]}</p>
                  <p className="text-sm text-white/70 mt-1">训练顺序按方法推进，休息不会跳过下一练。</p>
                </div>
                <button onClick={() => router.push('/training/today')} className="bg-white text-black rounded-xl px-4 py-2 text-sm font-medium">
                  开始今天
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-white/60">训练方法</p>
              <p className="text-lg font-semibold mt-2">
                {entryLoading
                  ? '正在读取训练方法'
                  : methodAvailable
                    ? '官方三分化已准备好'
                    : '官方三分化尚未开放'}
              </p>
              <p className="text-sm text-white/70 mt-1">
                {entryLoading ? '正在同步你的训练状态…' : methodMessage}
              </p>
              <div className="mt-4 flex items-center gap-3">
                <button
                  disabled={entryLoading || methodActivating}
                  onClick={handleMethodAction}
                  className="bg-white text-black rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-60"
                >
                  {entryLoading
                    ? '读取中…'
                    : methodActivating
                      ? '正在启用…'
                      : !profile?.onboarding_completed
                        ? '完成基础设置'
                        : methodAvailable
                          ? '启用训练方法'
                          : '查看训练方法'}
                </button>
                <button
                  onClick={() => router.push('/training/method')}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white/80"
                >
                  预览方法
                </button>
              </div>
            </>
          )}
        </div>

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
              { label: '记录自由训练', href: '/workout', icon: '🏋️' },
              { label: '记录饮食', href: '/food', icon: '🥗' },
              { label: '记录身体', href: '/body-metrics', icon: '📏' },
            ].map(({ label, href, icon }) => (
              <Link key={href} href={href} prefetch
                className="flex flex-col items-center rounded-xl border border-gray-100 py-3 text-xs text-gray-600 transition active:scale-[0.98] active:bg-gray-50">
                <span className="text-xl mb-1">{icon}</span>
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
