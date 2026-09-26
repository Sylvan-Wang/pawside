import { apiError } from '@/lib/api/response'
import {
  loadRecoveryCheckin,
  saveRecoveryCheckin,
} from '@/lib/recovery-persistence'
import {
  describeSelfReport,
  isValidSelfReport,
  shouldPromptCheckin,
} from '@/lib/recovery'
import { invalidateDayDerivedCache } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * /api/recovery/checkin — Recovery V1 (Product Patch §6–§8)
 *
 * GET  ?date=YYYY-MM-DD  -> today's check-in state + whether to prompt
 * POST { date, sleep_quality, post_workout_recovery, skipped? }
 *
 * Product §8 boundary: this route stores and describes subjective self-reports.
 * It does not decide that training is forbidden, and it does not scale volume.
 */

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sleep_quality: z.number().int().nullable().optional(),
  post_workout_recovery: z.number().int().nullable().optional(),
  skipped: z.boolean().optional(),
})

function validDate(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const date = request.nextUrl.searchParams.get('date')
  if (!validDate(date)) {
    return apiError('VALIDATION_ERROR', 'date 必须是 YYYY-MM-DD', 400)
  }

  try {
    const checkin = await loadRecoveryCheckin(supabase, user.id, date)
    return NextResponse.json({
      data: {
        checkin,
        should_prompt: shouldPromptCheckin(checkin),
        // Product §8: only these three descriptions are permitted.
        sleep_description: describeSelfReport(checkin?.sleep_quality_self_report ?? null),
        recovery_description: describeSelfReport(checkin?.post_workout_recovery_self_report ?? null),
      },
    })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法读取恢复记录',
      500,
    )
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '请检查恢复自评内容', 422, parsed.error.flatten())
  }

  const sleep = parsed.data.sleep_quality ?? null
  const recovery = parsed.data.post_workout_recovery ?? null

  // Guardrail §12 / Product §27: reject out-of-scale values rather than
  // clamping them, and keep "not answered" as null.
  if (sleep !== null && !isValidSelfReport(sleep)) {
    return apiError('VALIDATION_ERROR', '睡眠自评必须是 1–5 的整数', 422)
  }
  if (recovery !== null && !isValidSelfReport(recovery)) {
    return apiError('VALIDATION_ERROR', '训练后恢复自评必须是 1–5 的整数', 422)
  }

  // A skipped check-in records the skip (so it is not re-prompted) but stores
  // no fabricated values.
  const skipped = parsed.data.skipped ?? (sleep === null && recovery === null)

  try {
    await saveRecoveryCheckin(supabase, {
      userId: user.id,
      checkinDate: parsed.data.date,
      sleepQuality: sleep,
      postWorkoutRecovery: recovery,
      skipped,
    })

    // Recovery is part of the day's facts, so the day's caches go stale
    // (Product §21 explicitly lists "recovery check-in").
    const cacheInvalidation = await invalidateDayDerivedCache(supabase, user.id, parsed.data.date)

    return NextResponse.json({
      data: {
        saved: true,
        skipped,
        sleep_description: describeSelfReport(sleep),
        recovery_description: describeSelfReport(recovery),
        cache_invalidation: cacheInvalidation,
      },
    })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法保存恢复记录',
      500,
    )
  }
}
