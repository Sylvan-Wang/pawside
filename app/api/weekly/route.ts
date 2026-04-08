import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getWeekStart, generateWeeklySummary } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const weekStartParam = new URL(req.url).searchParams.get('week_start')
  const ws = weekStartParam || getWeekStart(new Date()).toISOString().split('T')[0]
  const weekEnd = new Date(ws)
  weekEnd.setDate(weekEnd.getDate() + 6)
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
  const allCal = foods.flatMap(f => (f.foods as { calories?: number }[]).map(x => x.calories || 0))
  const avgCalories = allCal.length > 0 ? Math.round(allCal.reduce((a, b) => a + b, 0) / 7) : 0

  const withWeight = metrics.filter(m => m.weight_kg)
  const weightChange = withWeight.length >= 2
    ? Number((withWeight[withWeight.length - 1].weight_kg - withWeight[0].weight_kg).toFixed(1))
    : null

  const summaryText = generateWeeklySummary(workoutCount, totalDuration, foodLogCount, avgCalories, weightChange, weekTarget)

  return NextResponse.json({
    workout_count: workoutCount,
    total_duration: totalDuration,
    food_log_count: foodLogCount,
    avg_calories: avgCalories,
    weight_change: weightChange,
    summary_text: summaryText,
  })
}
