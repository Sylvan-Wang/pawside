import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getWeekStartKey, generateWeeklySummary, shiftDateKey } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const url = new URL(req.url)
  const weekStartParam = url.searchParams.get('week_start')
  const requestedTimeZone = url.searchParams.get('time_zone') || 'UTC'
  let ws: string
  try {
    ws = weekStartParam || getWeekStartKey(new Date(), requestedTimeZone)
  } catch {
    return NextResponse.json({ error: '时区无效' }, { status: 422 })
  }
  const we = shiftDateKey(ws, 6)

  const [wRes, fRes, mRes, profileRes] = await Promise.all([
    supabase.from('workout_logs').select('date,duration_minutes,type').eq('user_id', user.id).gte('date', ws).lte('date', we),
    supabase.from('food_logs').select('date,foods').eq('user_id', user.id).gte('date', ws).lte('date', we),
    supabase.from('body_metrics').select('date,weight_kg').eq('user_id', user.id).gte('date', ws).lte('date', we).order('date'),
    supabase.from('user_profiles').select('weekly_workout_target').eq('id', user.id).single(),
  ])

  const workouts = wRes.data || []
  const foods = fRes.data || []
  const metrics = mRes.data || []
  // Product §4 / Guardrail §2.2: an unset weekly target stays null. The old
  // `|| 3` invented a goal and produced a fake "1/3" comparison.
  const weekTarget = profileRes.data?.weekly_workout_target ?? null

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
    weekly_workout_target: weekTarget,
    summary_text: summaryText,
  })
}
