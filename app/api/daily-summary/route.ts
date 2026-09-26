import { buildDailyLog } from '@/lib/nutrition/daily-log'
import { createClient } from '@/lib/supabase/server'
import { today } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'

const RULE_VERSION = 'canonical_daily_summary_v2'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const url = new URL(req.url)
  const timeZone = url.searchParams.get('time_zone') || 'UTC'
  let localToday: string
  try {
    localToday = today(timeZone)
  } catch {
    return NextResponse.json({ error: '时区无效' }, { status: 422 })
  }
  const date = url.searchParams.get('date') || localToday
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: '日期无效' }, { status: 422 })
  }

  const { data: cached } = await supabase
    .from('ai_generated_content')
    .select('content_json,prompt_version')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_summary')
    .eq('target_date', date)
    .maybeSingle()
  if (cached?.content_json && cached.prompt_version === RULE_VERSION) {
    return NextResponse.json(cached.content_json)
  }

  try {
    const log = await buildDailyLog(supabase, { userId: user.id, date, today: localToday })
    const summary = {
      workout_status: log.summary.workout_count > 0
        ? `已记录 ${log.summary.workout_count} 次训练`
        : '还没有训练记录',
      food_status: log.summary.meal_count > 0
        ? `已记录 ${log.summary.meal_count} 餐饮食`
        : '还没有饮食记录',
      suggestion: '',
      data_completeness: log.summary.data_completeness,
    }

    const { error } = await supabase.from('ai_generated_content').upsert({
      user_id: user.id,
      content_type: 'daily_summary',
      target_date: date,
      content_json: summary,
      prompt_version: RULE_VERSION,
    }, { onConflict: 'user_id,content_type,target_date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(summary)
  } catch (reason: unknown) {
    return NextResponse.json({
      error: reason instanceof Error ? reason.message : '读取失败',
    }, { status: 500 })
  }
}
