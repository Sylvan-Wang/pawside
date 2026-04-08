import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { preprocessDailyData } from '@/lib/ai-rules'
import { callAI, type DailyReviewResponse } from '@/lib/ai-client'
import { generateDailySummary } from '@/lib/utils'

// ─── GET: read cache ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const date = new URL(req.url).searchParams.get('date')
  if (!date) return NextResponse.json({ error: '缺少 date 参数' }, { status: 400 })

  const { data: cached } = await supabase
    .from('ai_generated_content')
    .select('content_json, feedback')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)
    .maybeSingle()

  if (cached?.content_json) {
    return NextResponse.json({ ...(cached.content_json as object), cached: true, feedback: cached.feedback })
  }

  return NextResponse.json({ cached: false }, { status: 404 })
}

// ─── POST: generate (with cache check) ───────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { date } = await req.json()
  if (!date) return NextResponse.json({ error: '缺少 date 参数' }, { status: 400 })

  // Return cached version if exists
  const { data: cached } = await supabase
    .from('ai_generated_content')
    .select('content_json, feedback')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)
    .maybeSingle()

  if (cached?.content_json) {
    return NextResponse.json({ ...(cached.content_json as object), cached: true, feedback: cached.feedback })
  }

  // Fetch all needed data in parallel
  const [wRes, fRes, mRes, profileRes] = await Promise.all([
    supabase.from('workout_logs').select('type,duration_minutes,exercises').eq('user_id', user.id).eq('date', date),
    supabase.from('food_logs').select('meal_type,foods').eq('user_id', user.id).eq('date', date),
    supabase.from('body_metrics').select('weight_kg,date').eq('user_id', user.id).order('date', { ascending: false }).limit(1),
    supabase.from('user_profiles').select('goal,gender,height_cm,weight_kg,weekly_workout_target,daily_calorie_target,preferred_model').eq('id', user.id).single(),
  ])

  const profile = profileRes.data
  if (!profile) return NextResponse.json({ error: '用户资料缺失' }, { status: 400 })

  const latestMetric = mRes.data?.[0] ?? null
  const preprocessed = preprocessDailyData(
    wRes.data || [],
    fRes.data || [],
    profile,
    latestMetric,
  )

  // Call AI
  let result: DailyReviewResponse | null = await callAI(
    (profile.preferred_model as 'openai' | 'deepseek') || 'openai',
    preprocessed,
  )

  // Fallback to rule-based if AI fails
  const promptVersion = result ? `ai_daily_review_v1_${profile.preferred_model}` : 'rule_fallback_v1'
  if (!result) {
    const ruleSummary = generateDailySummary(wRes.data || [], fRes.data || [], profile)
    result = {
      summary: ruleSummary.workout_status + '。' + ruleSummary.food_status,
      insights: [ruleSummary.suggestion],
      actions: [],
      data_quality_tip: '',
      tone: 'encouraging',
      cached: false,
    }
  }

  // Write cache
  await supabase.from('ai_generated_content').upsert({
    user_id: user.id,
    content_type: 'daily_review_ai',
    target_date: date,
    content_json: result,
    prompt_version: promptVersion,
  }, { onConflict: 'user_id,content_type,target_date' })

  return NextResponse.json(result)
}

// ─── PATCH: feedback ──────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { date, feedback } = await req.json()
  if (!date || !['liked', 'disliked', null].includes(feedback)) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }

  const { error } = await supabase
    .from('ai_generated_content')
    .update({ feedback })
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
