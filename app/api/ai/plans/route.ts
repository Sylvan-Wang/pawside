import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import {
  ADVISORY_PLAN_PROMPT_VERSION,
  callAdvisoryPlan,
} from '@/lib/ai-client'

const MAX_INPUT_BYTES = 16_000
const MAX_PLANS_PER_HOUR = 5

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('UNAUTHORIZED', '未登录', 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError('INVALID_JSON', '请求体不是有效 JSON', 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiError('VALIDATION_ERROR', '请求体必须是对象', 400)
  }

  const { plan_type: planType, input } = body as {
    plan_type?: unknown
    input?: unknown
  }

  if (
    typeof planType !== 'string' ||
    !/^[a-z][a-z0-9_-]{1,39}$/i.test(planType) ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return apiError('VALIDATION_ERROR', 'plan_type 或 input 参数无效', 400)
  }

  const inputJson = JSON.stringify(input)
  if (Buffer.byteLength(inputJson, 'utf8') > MAX_INPUT_BYTES) {
    return apiError('VALIDATION_ERROR', 'input 超过 16KB 限制', 400)
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString()
  const { count, error: countError } = await supabase
    .from('ai_plans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', oneHourAgo)

  if (countError) return apiError('DATABASE_ERROR', '无法检查生成额度', 500)
  if ((count || 0) >= MAX_PLANS_PER_HOUR) {
    return apiError('RATE_LIMITED', '每小时最多生成 5 个计划草稿', 429)
  }

  const aiResult = await callAdvisoryPlan(
    planType,
    input as Record<string, unknown>,
  )

  if (!aiResult.ok) {
    if (aiResult.reason === 'not_configured') {
      return apiError('AI_NOT_CONFIGURED', 'OpenAI 尚未配置', 503)
    }
    if (aiResult.reason === 'rate_limited') {
      return apiError('RATE_LIMITED', 'OpenAI 请求过于频繁，请稍后重试', 429)
    }
    return apiError('AI_PROVIDER_ERROR', 'OpenAI 暂时不可用，请稍后重试', 502)
  }

  const plan = {
    ...aiResult.data,
    generation: {
      provider: aiResult.provider,
      model: aiResult.model,
    },
  }

  const { data, error } = await supabase.from('ai_plans').insert({
    user_id: user.id,
    plan_type: planType,
    status: 'draft',
    source: 'openai',
    input_snapshot: input,
    plan_json: plan,
    summary_text: aiResult.data.summary,
    prompt_version: ADVISORY_PLAN_PROMPT_VERSION,
  }).select('id').single()

  if (error) return apiError('DATABASE_ERROR', '计划草稿保存失败', 500)
  return NextResponse.json({
    success: true,
    data: {
      plan_id: data.id,
      status: 'draft',
      summary_text: aiResult.data.summary,
      provider: aiResult.provider,
      model: aiResult.model,
    },
  })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('UNAUTHORIZED', '未登录', 401)

  const { data, error } = await supabase
    .from('ai_plans')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return apiError('DATABASE_ERROR', '计划草稿读取失败', 500)
  return NextResponse.json({ data })
}
