import { apiError } from '@/lib/api/response'
import { buildWeeklyAggregate } from '@/lib/nutrition/weekly-log'
import { buildWeeklyReviewInput } from '@/lib/nutrition/weekly-review'
import { getWeekStartKey } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * /api/weekly-log — Weekly Log aggregate (Product §22–§24)
 *
 * GET ?week_start=YYYY-MM-DD
 *
 * AI Patch §29 / AC-AI11: the trend classifications in this payload are computed
 * by code (lib/nutrition/trend.ts). `review_input` is the exact, bounded input a
 * Weekly Review model may receive — it contains classifications, not raw series,
 * so the model has nothing to eyeball.
 */

function isDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const requested = request.nextUrl.searchParams.get('week_start')
  const requestedTimeZone = request.nextUrl.searchParams.get('time_zone') || 'UTC'
  let weekStart: string
  try {
    weekStart = isDate(requested)
      ? requested
      : getWeekStartKey(new Date(), requestedTimeZone)
  } catch {
    return apiError('VALIDATION_ERROR', '时区无效', 422)
  }

  try {
    const aggregate = await buildWeeklyAggregate(supabase, user.id, weekStart)
    return NextResponse.json({
      data: aggregate,
      review_input: buildWeeklyReviewInput(aggregate),
    })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法读取周记录',
      500,
    )
  }
}
