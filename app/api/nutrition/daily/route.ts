import { apiError } from '@/lib/api/response'
import { reconcileDailySummary, getDailyNutritionFacts, resolveNutrientTargets } from '@/lib/nutrition/persistence'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * /api/nutrition/daily — daily nutrition facts for the logged-in user.
 *
 * GET   ?date=YYYY-MM-DD  -> { target, consumed, remaining, meal_count, data_completeness }
 * POST  { date }          -> recompute daily_nutrition_summary from normalized items
 *
 * This is the Phase A Fact layer that Meal Feedback / Daily Log / Home consume.
 * It never returns an AI value: Product §10.1 requires Facts first and
 * Product §27 requires an unset target to stay null.
 */

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
    // Target resolution is deterministic; AI Patch §12.1 owns the formula.
    const target = await resolveNutrientTargets(supabase, user.id, date)
    const facts = await getDailyNutritionFacts(supabase, user.id, date, target)
    return NextResponse.json({ data: facts })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法读取当日营养',
      500,
    )
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }

  const date = body && typeof body === 'object' ? (body as { date?: unknown }).date : null
  if (!validDate(typeof date === 'string' ? date : null)) {
    return apiError('VALIDATION_ERROR', 'date 必须是 YYYY-MM-DD', 400)
  }

  try {
    // Used after an edit/delete so the cached summary cannot drift (Product §21).
    await reconcileDailySummary(supabase, user.id, date as string)
    const target = await resolveNutrientTargets(supabase, user.id, date as string)
    const facts = await getDailyNutritionFacts(supabase, user.id, date as string, target)
    return NextResponse.json({ data: facts })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法重算当日营养',
      500,
    )
  }
}
