import { composeWithEvidence } from '@/lib/evidence/composer'
import {
  buildDailyReviewEvidence,
  DAILY_REVIEW_INSTRUCTIONS,
} from '@/lib/evidence/daily-review'
import { AI_PROMPT_VERSIONS, AI_SCHEMAS } from '@/lib/evidence/ai-schemas'
import { EVIDENCE_REGISTRY_VERSION, resolveCitations } from '@/lib/evidence/registry'
import { loadFeedback, upsertFeedback } from '@/lib/feedback'
import { createClient } from '@/lib/supabase/server'
import { today } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { coachFlag, coachOutputV1Enabled } from '@/lib/coach/flags'
import {
  COACH_PROMPT_VERSION_SUFFIX,
  DAILY_REVIEW_INSTRUCTIONS_V2,
  DAILY_REVIEW_INSTRUCTIONS_COACH_OUTPUT_V1,
  COACH_OUTPUT_V1_SHARED_RULES,
} from '@/lib/coach/prompts'
import {
  buildCoachOutputSchema,
  computeAllowedActions,
  rankSignalsForContext,
  COACH_OUTPUT_PROMPT_VERSIONS,
  compatibleReview as toDailyReviewV1Shape,
  type CoachOutputV1,
} from '@/lib/evidence/coach-output'

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

  // Coach patch 2026-09-27: prompt v2 carries a version suffix, so reviews
  // cached under the old prompt are regenerated once instead of being served.
  // spec A0-4: coach_output_v1 is its own bundle with its own prompt_version.
  const promptV2 = coachFlag('COACH_PROMPT_V2')
  const expectedPromptVersion = coachOutputV1Enabled()
    ? COACH_OUTPUT_PROMPT_VERSIONS.daily_review
    : promptV2
      ? `${AI_PROMPT_VERSIONS.daily_review}+${COACH_PROMPT_VERSION_SUFFIX}`
      : AI_PROMPT_VERSIONS.daily_review

  if (cached?.content_json && cached.prompt_version === expectedPromptVersion) {
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

  // Coach patch 2026-09-27: prompt v2 carries a version suffix, so reviews
  // cached under the old prompt are regenerated once instead of being served.
  // spec A0-4: coach_output_v1 is its own bundle with its own prompt_version.
  const promptV2 = coachFlag('COACH_PROMPT_V2')
  const dailyOutputV1 = coachOutputV1Enabled()
  const expectedPromptVersion = dailyOutputV1
    ? COACH_OUTPUT_PROMPT_VERSIONS.daily_review
    : promptV2
      ? `${AI_PROMPT_VERSIONS.daily_review}+${COACH_PROMPT_VERSION_SUFFIX}`
      : AI_PROMPT_VERSIONS.daily_review

  if (cached?.content_json && cached.prompt_version === expectedPromptVersion) {
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
    const dailyAllowedActions = computeAllowedActions({
      surface: 'daily_review',
      hasNextSession: (evidence.context as { next_training?: unknown }).next_training != null,
      hasRecoveryCheckinToday: evidence.log.recovery.recorded,
    })
    const composed = await composeWithEvidence({
      surface: 'daily_review',
      facts: evidence.facts,
      signals: evidence.signals,
      userId: user.id,
      scopeId: date,
      context: {
        ...evidence.context,
        ...(dailyOutputV1
          ? { allowed_actions: dailyAllowedActions, ranked_signals: rankSignalsForContext(evidence.signals) }
          : {}),
      },
      instructions: dailyOutputV1
        ? `${DAILY_REVIEW_INSTRUCTIONS_COACH_OUTPUT_V1}\n\n${COACH_OUTPUT_V1_SHARED_RULES}`
        : promptV2 ? DAILY_REVIEW_INSTRUCTIONS_V2 : DAILY_REVIEW_INSTRUCTIONS,
      ...(dailyOutputV1
        ? {
          schemaOverride: {
            name: `${AI_SCHEMAS.daily_review.name}_v1`,
            schema: buildCoachOutputSchema('daily_review'),
            maxOutputTokens: AI_SCHEMAS.daily_review.maxOutputTokens,
            promptVersion: COACH_OUTPUT_PROMPT_VERSIONS.daily_review,
          },
          allowedActions: dailyAllowedActions,
        }
        : promptV2
          ? { outputGuard: coachFlag('COACH_OUTPUT_GUARD'), promptVersionSuffix: COACH_PROMPT_VERSION_SUFFIX }
          : {}),
    })

    const review = composed.ok
      ? (dailyOutputV1 ? toDailyReviewV1Shape(composed.data as CoachOutputV1, 'daily_review') : composed.data) as DailyReviewOutput
      : null
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
      prompt_version: composed.ok ? composed.promptVersion : expectedPromptVersion,
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
