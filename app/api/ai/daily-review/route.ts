import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { preprocessDailyData } from '@/lib/ai-rules'
import {
  callDailyReview,
  DAILY_REVIEW_PROMPT_VERSION,
  getOpenAIConfigStatus,
  type DailyReviewPayload,
  type OpenAIFailureReason,
} from '@/lib/ai-client'
import { generateDailySummary } from '@/lib/utils'

interface DailyReviewResponse extends DailyReviewPayload {
  cached: boolean
  generation: {
    source: 'openai' | 'rules' | 'no_data'
    provider: 'openai'
    model: string
    fallback_reason: OpenAIFailureReason | null
  }
}

// ─── GET: read cache ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const date = new URL(req.url).searchParams.get('date')
  if (!date) return NextResponse.json({ error: '缺少 date 参数' }, { status: 400 })

  const { data: cached } = await supabase
    .from('ai_generated_content')
    .select('content_json, feedback, prompt_version')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)
    .maybeSingle()

  if (cached?.content_json && cached.prompt_version === DAILY_REVIEW_PROMPT_VERSION) {
    return NextResponse.json({ ...(cached.content_json as object), cached: true, feedback: cached.feedback })
  }

  return NextResponse.json({ cached: false }, { status: 404 })
}

// ─── POST: generate (with cache check) ───────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 })
  }
  const date = body && typeof body === 'object' ? (body as { date?: unknown }).date : null
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date 必须是 YYYY-MM-DD' }, { status: 400 })
  }

  // Check cache first
  const { data: cached } = await supabase
    .from('ai_generated_content')
    .select('content_json, feedback, prompt_version')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)
    .maybeSingle()

  if (cached?.content_json && cached.prompt_version === DAILY_REVIEW_PROMPT_VERSION) {
    return NextResponse.json({ ...(cached.content_json as object), cached: true, feedback: cached.feedback })
  }

  // Fetch all needed data in parallel
  const [wRes, fRes, mRes, profileRes] = await Promise.all([
    supabase.from('workout_logs').select('type,duration_minutes,exercises').eq('user_id', user.id).eq('date', date),
    supabase.from('food_logs').select('meal_type,foods').eq('user_id', user.id).eq('date', date),
    supabase.from('body_metrics').select('weight_kg,date').eq('user_id', user.id).order('date', { ascending: false }).limit(1),
    supabase.from('user_profiles').select('goal,gender,height_cm,weight_kg,weekly_workout_target,daily_calorie_target').eq('id', user.id).single(),
  ])

  const profile = profileRes.data
  if (!profile) return NextResponse.json({ error: '用户资料缺失' }, { status: 400 })

  const workouts = wRes.data || []
  const foods = fRes.data || []

  // Edge case: no data at all — don't call AI
  if (workouts.length === 0 && foods.length === 0) {
    const openAI = getOpenAIConfigStatus()
    const noDataResult: DailyReviewResponse = {
      summary: '今天还没有记录，去完成第一条吧！',
      insights: [],
      actions: ['记录今天的训练或饮食，开始你的复盘之旅'],
      data_quality_tip: '',
      tone: 'encouraging',
      cached: false,
      generation: {
        source: 'no_data',
        provider: 'openai',
        model: openAI.model,
        fallback_reason: null,
      },
    }
    return NextResponse.json(noDataResult)
  }

  const latestMetric = mRes.data?.[0] ?? null
  const preprocessed = preprocessDailyData(workouts, foods, profile, latestMetric)

  const aiResult = await callDailyReview(preprocessed)
  let result: DailyReviewResponse

  if (aiResult.ok) {
    result = {
      ...aiResult.data,
      cached: false,
      generation: {
        source: 'openai',
        provider: aiResult.provider,
        model: aiResult.model,
        fallback_reason: null,
      },
    }
  } else {
    const ruleSummary = generateDailySummary(workouts, foods, profile)
    result = {
      summary: ruleSummary.workout_status + '。' + ruleSummary.food_status,
      insights: [ruleSummary.suggestion].filter(Boolean),
      actions: [],
      data_quality_tip: '',
      tone: 'encouraging',
      cached: false,
      generation: {
        source: 'rules',
        provider: aiResult.provider,
        model: aiResult.model,
        fallback_reason: aiResult.reason,
      },
    }
  }

  // Cache only real OpenAI results. A missing key or provider outage must not
  // create a durable fallback that masks recovery on the next request.
  if (aiResult.ok) {
    const { error: cacheError } = await supabase.from('ai_generated_content').upsert({
      user_id: user.id,
      content_type: 'daily_review_ai',
      target_date: date,
      content_json: result,
      prompt_version: DAILY_REVIEW_PROMPT_VERSION,
    }, { onConflict: 'user_id,content_type,target_date' })
    if (cacheError) console.error('[daily-review] Failed to cache OpenAI result')
  }

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
