import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const [wRes, fRes, mRes, wsRes] = await Promise.all([
    supabase.from('workout_logs').select('*').eq('user_id', user.id).order('date'),
    supabase.from('food_logs').select('*').eq('user_id', user.id).order('date'),
    supabase.from('body_metrics').select('*').eq('user_id', user.id).order('date'),
    supabase.from('weekly_summary').select('*').eq('user_id', user.id).order('week_start'),
  ])

  function toCSV(rows: Record<string, unknown>[], cols: string[]) {
    return [cols.join(','), ...rows.map(r =>
      cols.map(c => JSON.stringify(r[c] ?? '')).join(',')
    )].join('\n')
  }

  const parts = [
    '=== 训练记录 ===',
    toCSV(wRes.data || [], ['date', 'type', 'duration_minutes', 'notes', 'exercises']),
    '\n=== 饮食记录 ===',
    toCSV(fRes.data || [], ['date', 'meal_type', 'foods']),
    '\n=== 身体数据 ===',
    toCSV(mRes.data || [], ['date', 'weight_kg', 'body_fat_pct', 'muscle_mass', 'waist_cm', 'hip_cm', 'chest_cm', 'notes']),
    '\n=== 每周总结 ===',
    toCSV(wsRes.data || [], ['week_start', 'workout_count', 'total_duration', 'food_log_count', 'avg_calories', 'weight_change']),
  ].join('\n')

  return new NextResponse(parts, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pawside_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
