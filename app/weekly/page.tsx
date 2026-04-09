'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BottomNav from '@/components/BottomNav'
import PageHeader from '@/components/PageHeader'
import { getWeekStart, generateWeeklySummary } from '@/lib/utils'
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, LineChart, Line } from 'recharts'

interface WeeklyData {
  workoutCount: number
  totalDuration: number
  foodLogCount: number
  avgCalories: number
  weightChange: number | null
  workoutByDay: { day: string; count: number; duration: number }[]
  calorieByDay: { day: string; calories: number }[]
  weightByDay: { day: string; weight: number }[]
  summaryText: string
  weekTarget: number
}

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export default function WeeklyPage() {
  const router = useRouter()
  const supabase = createClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const [data, setData] = useState<WeeklyData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (offset: number) => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/auth'); return }

    const weekStart = getWeekStart(new Date())
    weekStart.setDate(weekStart.getDate() - offset * 7)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)

    const ws = weekStart.toISOString().split('T')[0]
    const we = weekEnd.toISOString().split('T')[0]

    const [wRes, fRes, mRes, profileRes] = await Promise.all([
      supabase.from('workout_logs').select('date,duration_minutes,type').eq('user_id', user.id).gte('date', ws).lte('date', we),
      supabase.from('food_logs').select('date,foods').eq('user_id', user.id).gte('date', ws).lte('date', we),
      supabase.from('body_metrics').select('date,weight_kg').eq('user_id', user.id).gte('date', ws).lte('date', we).order('date'),
      supabase.from('user_profiles').select('weekly_workout_target').eq('id', user.id).single(),
    ])

    const workouts = wRes.data || []
    const foods = fRes.data || []
    const metrics = mRes.data || []
    const weekTarget = profileRes.data?.weekly_workout_target || 3

    const workoutCount = workouts.length
    const totalDuration = workouts.reduce((s, w) => s + w.duration_minutes, 0)
    const foodLogCount = foods.length
    const allCalories = foods.flatMap(f => (f.foods as { calories?: number }[]).map(x => x.calories || 0))
    const avgCalories = allCalories.length > 0 ? Math.round(allCalories.reduce((a, b) => a + b, 0) / 7) : 0

    const withWeight = metrics.filter(m => m.weight_kg)
    const weightChange = withWeight.length >= 2
      ? Number((withWeight[withWeight.length - 1].weight_kg - withWeight[0].weight_kg).toFixed(1))
      : null

    // By day
    const workoutByDay = DAYS.map((day, i) => {
      const date = new Date(weekStart)
      date.setDate(date.getDate() + i)
      const ds = date.toISOString().split('T')[0]
      const dayWorkouts = workouts.filter(w => w.date === ds)
      return { day, count: dayWorkouts.length, duration: dayWorkouts.reduce((s, w) => s + w.duration_minutes, 0) }
    })

    const calorieByDay = DAYS.map((day, i) => {
      const date = new Date(weekStart)
      date.setDate(date.getDate() + i)
      const ds = date.toISOString().split('T')[0]
      const dayFoods = foods.filter(f => f.date === ds)
      const cal = dayFoods.flatMap(f => (f.foods as { calories?: number }[]).map(x => x.calories || 0)).reduce((a, b) => a + b, 0)
      return { day, calories: cal }
    })

    const weightByDay = metrics.filter(m => m.weight_kg).map(m => ({
      day: m.date.slice(5),
      weight: m.weight_kg,
    }))

    const summaryText = generateWeeklySummary(workoutCount, totalDuration, foodLogCount, avgCalories, weightChange, weekTarget)

    setData({ workoutCount, totalDuration, foodLogCount, avgCalories, weightChange, workoutByDay, calorieByDay, weightByDay, summaryText, weekTarget })
    setLoading(false)
  }, [router, supabase])

  useEffect(() => { load(weekOffset) }, [load, weekOffset])

  const weekStart = getWeekStart(new Date())
  weekStart.setDate(weekStart.getDate() - weekOffset * 7)
  const weekLabel = weekOffset === 0 ? '本周' : weekOffset === 1 ? '上周' : `${weekStart.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 那周`

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <PageHeader title="每周报告" />

      {/* Week switcher */}
      <div className="bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 text-xl px-2">←</button>
        <p className="text-sm font-medium">{weekLabel}</p>
        <button onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset === 0}
          className="text-gray-400 text-xl px-2 disabled:opacity-30">→</button>
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-12">加载中…</p>
      ) : !data || (data.workoutCount === 0 && data.foodLogCount === 0) ? (
        <div className="text-center py-12"><p className="text-gray-400 text-sm">本周暂无数据</p></div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          {/* Summary */}
          <div className="bg-white rounded-2xl p-4">
            <p className="text-sm text-gray-700 leading-relaxed">{data.summaryText}</p>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '本周训练次数', value: `${data.workoutCount} 次` },
              { label: '本周总时长', value: `${data.totalDuration} 分钟` },
              { label: '饮食记录次数', value: `${data.foodLogCount} 次` },
              { label: '平均热量', value: data.avgCalories > 0 ? `${data.avgCalories} kcal` : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-2xl p-4">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className="text-base font-semibold">{value}</p>
              </div>
            ))}
          </div>

          {/* Workout trend */}
          <div className="bg-white rounded-2xl p-4">
            <p className="text-sm font-semibold mb-3">本周训练趋势</p>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={data.workoutByDay}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [`${v} 分钟`, '']} contentStyle={{ fontSize: 11, border: 'none', background: '#f5f5f5', borderRadius: 8 }} />
                <Bar dataKey="duration" fill="#000" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Calorie trend */}
          {data.calorieByDay.some(d => d.calories > 0) && (
            <div className="bg-white rounded-2xl p-4">
              <p className="text-sm font-semibold mb-3">热量趋势</p>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={data.calorieByDay}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [`${v} kcal`, '']} contentStyle={{ fontSize: 11, border: 'none', background: '#f5f5f5', borderRadius: 8 }} />
                  <Bar dataKey="calories" fill="#888" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Weight change */}
          {data.weightByDay.length >= 2 && (
            <div className="bg-white rounded-2xl p-4">
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm font-semibold">体重变化</p>
                {data.weightChange !== null && (
                  <p className={`text-sm font-medium ${data.weightChange < 0 ? 'text-green-600' : data.weightChange > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {data.weightChange > 0 ? '+' : ''}{data.weightChange} kg
                  </p>
                )}
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={data.weightByDay}>
                  <XAxis dataKey="day" hide />
                  <Tooltip formatter={(v: number) => [`${v} kg`, '']} contentStyle={{ fontSize: 11, border: 'none', background: '#f5f5f5', borderRadius: 8 }} />
                  <Line type="monotone" dataKey="weight" stroke="#000" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      <BottomNav />
    </div>
  )
}
