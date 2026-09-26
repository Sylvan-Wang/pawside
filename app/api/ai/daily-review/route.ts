import { composeWithEvidence } from '@/lib/evidence/composer'
import {
  buildDailyReviewEvidence,
  DAILY_REVIEW_INSTRUCTIONS,
} from '@/lib/evidence/daily-review'
import { AI_PROMPT_VERSIONS } from '@/lib/evidence/ai-schemas'
import { EVIDENCE_REGISTRY_VERSION, resolveCitations } from '@/lib/evidence/registry'
import { loadFeedback, upsertFeedback } from '@/lib/feedback'
import { createClient } from '@/lib/supabase/server'
import { today } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const requestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_zone: z.string().trim().min(1).max(100).optional(),
})

const feedbackSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feedback: z.enum(['liked', 'disliked']).nullable(),
})

interface DailyReviewOutput {
  overall: string
  key_findings: Array<{ text: string; domain: string; evidence_ref_ids: string[] }>
  tomorrow_guidance: Array<{ text: string; basis: string }>
  safety: { level: string; text: string | null; evidence_ref_ids: string[] }
  data_quality_tip: string | null
}

function compatibleReview(output: DailyReviewOutput | null) {
  return {
    summary: output?.overall ?? '今日事实已更新，AI 解释暂不可用。',
    insights: output?.key_findings.map((entry) => entry.text) ?? [],
    actions: output?.tomorrow_guidance.map((entry) => entry.text) ?? [],
    data_quality_tip: output?.data_quality_tip ?? '',
    tone: 'neutral',
  }
}

async function currentFeedback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  date: string,
) {
  const record = await loadFeedback(supabase, userId, 'daily_review', date)
  return record?.rating ?? null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const date = new URL(req.url).searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: '缺少有效的 date 参数' }, { status: 400 })
  }

  const { data: cached, error } = await supabase
    .from('ai_generated_content')
    .select('content_json,prompt_version')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (cached?.content_json && cached.prompt_version === AI_PROMPT_VERSIONS.daily_review) {
    return NextResponse.json({
      ...(cached.content_json as object),
      cached: true,
      feedback: await currentFeedback(supabase, user.id, date),
    })
  }

  return NextResponse.json({ cached: false })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'date 必须是 YYYY-MM-DD' }, { status: 400 })
  }
  const { date, time_zone: timeZone = 'UTC' } = parsed.data

  const { data: cached } = await supabase
    .from('ai_generated_content')
    .select('content_json,prompt_version')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)
    .maybeSingle()

  if (cached?.content_json && cached.prompt_version === AI_PROMPT_VERSIONS.daily_review) {
    return NextResponse.json({
      ...(cached.content_json as object),
      cached: true,
      feedback: await currentFeedback(supabase, user.id, date),
    })
  }

  try {
    const evidence = await buildDailyReviewEvidence(supabase, {
      userId: user.id,
      date,
      today: today(timeZone),
    })
    const composed = await composeWithEvidence({
      surface: 'daily_review',
      facts: evidence.facts,
      signals: evidence.signals,
      context: evidence.context,
      instructions: DAILY_REVIEW_INSTRUCTIONS,
    })

    const review = composed.ok ? composed.data as DailyReviewOutput : null
    const evidenceIds = review
      ? [...review.key_findings.flatMap((entry) => entry.evidence_ref_ids), ...review.safety.evidence_ref_ids]
      : []
    const compatibility = compatibleReview(review)
    const result = {
      ...compatibility,
      review,
      facts: evidence.facts,
      signals: evidence.signals,
      citations: resolveCitations([...new Set(evidenceIds)]),
      cached: false,
      feedback: await currentFeedback(supabase, user.id, date),
      ai_status: composed.ok
        ? { available: true, reason: null, detail: null }
        : { available: false, reason: composed.reason, detail: composed.detail ?? null },
      generation: {
        source: composed.ok ? 'composer' : 'deterministic_only',
        provider: 'openai',
        model: composed.model,
        fallback_reason: composed.ok ? null : composed.reason,
      },
      prompt_version: composed.ok ? composed.promptVersion : AI_PROMPT_VERSIONS.daily_review,
      model: composed.model,
      evidence_registry_version: EVIDENCE_REGISTRY_VERSION,
      input_snapshot_id: composed.ok ? composed.inputSnapshotId : null,
    }

    // Only a real Composer result is durable. Provider or guardrail failures
    // must recover automatically on the next request.
    if (composed.ok) {
      const { error: cacheError } = await supabase.from('ai_generated_content').upsert({
        user_id: user.id,
        content_type: 'daily_review_ai',
        target_date: date,
        content_json: result,
        prompt_version: composed.promptVersion,
      }, { onConflict: 'user_id,content_type,target_date' })
      if (cacheError) return NextResponse.json({ error: cacheError.message }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (reason: unknown) {
    return NextResponse.json({
      error: reason instanceof Error ? reason.message : '暂时无法生成复盘',
    }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 })
  }
  const parsed = feedbackSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const { data: cached, error } = await supabase
    .from('ai_generated_content')
    .select('content_json,prompt_version')
    .eq('user_id', user.id)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', parsed.data.date)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const content = cached?.content_json as Record<string, unknown> | null
  const model = typeof content?.model === 'string' ? content.model : null
  const snapshot = typeof content?.input_snapshot_id === 'string' ? content.input_snapshot_id : null
  if (!cached || !content || !model || !snapshot) {
    return NextResponse.json({ error: '当前复盘缺少可追溯信息，不能记录评价' }, { status: 409 })
  }

  try {
    await upsertFeedback(supabase, {
      userId: user.id,
      contentType: 'daily_review',
      scope: 'day',
      scopeId: parsed.data.date,
      rating: parsed.data.feedback,
      promptVersion: cached.prompt_version,
      model,
      inputSnapshotId: snapshot,
      evidenceRegistryVersion: typeof content.evidence_registry_version === 'string'
        ? content.evidence_registry_version
        : null,
      outputJson: content.review ?? null,
    })
    return NextResponse.json({ success: true })
  } catch (reason: unknown) {
    return NextResponse.json({
      error: reason instanceof Error ? reason.message : '暂时无法保存反馈',
    }, { status: 500 })
  }
}
