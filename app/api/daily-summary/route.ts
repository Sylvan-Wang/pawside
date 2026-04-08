import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { generateDailySummary } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const date = new URL(req.url).searchParams.get('date') || new Date().toISOString().split('T')[0]

  // Check AI cache first
  const { data: cached } = await supabase
    .from('ai_generated_content')
    .select('content_json, content_text')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_summary')
    .eq('target_date', date)
    .maybeSingle()

  if (cached?.content_json) return NextResponse.json(cached.content_json)

  const [wRes, fRes, profileRes] = await Promise.all([
    supabase.from('workout_logs').select('type,duration_minutes').eq('user_id', user.id).eq('date', date),
    supabase.from('food_logs').select('meal_type,foods').eq('user_id', user.id).eq('date', date),
    supabase.from('user_profiles').select('daily_calorie_target').eq('id', user.id).single(),
  ])

  const summary = generateDailySummary(wRes.data || [], fRes.data || [], profileRes.data)

  // Cache rule-generated summary
  await supabase.from('ai_generated_content').upsert({
    user_id: user.id,
    content_type: 'daily_summary',
    target_date: date,
    content_json: summary,
    prompt_version: 'rule_v1',
  }, { onConflict: 'user_id,content_type,target_date' })

  return NextResponse.json(summary)
}
