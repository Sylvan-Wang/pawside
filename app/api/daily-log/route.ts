import { apiError } from '@/lib/api/response'
import { adjacentDates, buildDailyLog, toDashboardNutrition } from '@/lib/nutrition/daily-log'
import { createClient } from '@/lib/supabase/server'
import { dateKeyInTimeZone } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'

/**
 * /api/daily-log — the Daily Log payload (Product Patch §15–§21)
 *
 * GET ?date=YYYY-MM-DD&preload=1&today=YYYY-MM-DD
 *
 * Sections returned in Product §16 order:
 *   dashboard nutrition -> recovery -> workouts -> meals -> body
 *   -> daily review cache state
 *
 * `preload=1` (Product §20 / AC-P12) additionally reports whether the adjacent
 * days already have cached content, so switching dates does not always wait for
 * a full regeneration. It deliberately does NOT generate anything.
 *
 * Product §19 / AC-P11: `is_today` and `period_label` let the UI distinguish a
 * finished historical day from an in-progress one.
 */

function isDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const params = request.nextUrl.searchParams
  const date = params.get('date')
  if (!isDate(date)) {
    return apiError('VALIDATION_ERROR', 'date 必须是 YYYY-MM-DD', 400)
  }

  // The client supplies its local day so "today" is the user's natural day.
  // If it is absent, derive it from an explicit timezone rather than UTC.
  const todayParam = params.get('today')
  const requestedTimeZone = params.get('time_zone') || 'UTC'
  let today: string
  try {
    today = isDate(todayParam) ? todayParam : dateKeyInTimeZone(new Date(), requestedTimeZone)
  } catch {
    return apiError('VALIDATION_ERROR', 'time_zone 无效', 422)
  }
  const preload = params.get('preload') === '1'

  try {
    const dailyLog = await buildDailyLog(supabase, { userId: user.id, date, today })

    const response: Record<string, unknown> = {
      data: {
        ...dailyLog,
        dashboard_nutrition: toDashboardNutrition(dailyLog.nutrition),
      },
    }

    if (preload) {
      const { previous, next } = adjacentDates(date)
      // Readiness only: report whether a cached review exists, so the client can
      // render instantly and refresh in the background (Product §21).
      const { data: cached } = await supabase
        .from('ai_generated_content')
        .select('target_date,prompt_version')
        .eq('user_id', user.id)
        .eq('content_type', 'daily_review_ai')
        .in('target_date', [previous, next])

      const cachedDates = new Set((cached ?? []).map((row) => row.target_date))
      response.neighbors = {
        previous: { date: previous, review_cached: cachedDates.has(previous) },
        next: { date: next, review_cached: cachedDates.has(next) },
      }
    }

    return NextResponse.json(response)
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法读取当日记录',
      500,
    )
  }
}
