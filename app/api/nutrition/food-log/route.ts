import { apiError } from '@/lib/api/response'
import { createFoodLogBodySchema } from '@/lib/nutrition/api-contracts'
import { computeMealFeedbackStatus } from '@/lib/nutrition/meal-feedback'
import {
  getDailyNutritionFacts,
  resolveNutrientTargets,
  saveFoodLog,
  type FoodItemInput,
  type MealType,
} from '@/lib/nutrition/persistence'
import { createClient } from '@/lib/supabase/server'
import { invalidateDayDerivedCache } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/nutrition/food-log
 *
 * Canonical nutrition write path (Product §9 / §21, AI Patch §9).
 *
 * Replaces the previous pattern of a direct client-side insert into the legacy
 * `food_logs` JSONB with a route that:
 *   1. derives all four macros deterministically from the food reference,
 *   2. writes the normalized tables (`user_food_logs` + `user_food_log_items`),
 *   3. reconciles `daily_nutrition_summary`,
 *   4. mirrors a compatibility row into `food_logs` for not-yet-migrated screens,
 *   5. invalidates the cached daily review.
 *
 * The legacy mirror is deliberately server-side: the client must not keep
 * making the nutrition facts itself.
 */

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

  const parsed = createFoodLogBodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '请检查饮食记录内容', 422, parsed.error.flatten())
  }

  const { request_id, date, meal_type, raw_input_text, notes, items } = parsed.data

  try {
    const result = await saveFoodLog(supabase, {
      userId: user.id,
      requestId: request_id,
      logDate: date,
      mealType: meal_type as MealType,
      rawInputText: raw_input_text ?? null,
      notes: notes ?? null,
      items: items as FoodItemInput[],
    })

    // Invalidate cached review AND the rule daily-summary so the next Daily Log
    // read reflects this meal (Product §21). Legacy mirror failure must not fail
    // the canonical write.
    const cacheInvalidation = await invalidateDayDerivedCache(supabase, user.id, date)
    const target = await resolveNutrientTargets(supabase, user.id, date)
    const nutrition = await getDailyNutritionFacts(supabase, user.id, date, target)
    const status = computeMealFeedbackStatus(nutrition, { isCompleteDay: false })

    return NextResponse.json({
      data: {
        food_log_id: result.foodLogId,
        legacy_food_log_id: result.legacyFoodLogId,
        items: result.items,
        has_estimated_items: result.hasEstimatedItems,
        idempotent: result.idempotent,
        legacy_mirror: 'ok',
        nutrition,
        status,
        cache_invalidation: cacheInvalidation,
      },
    })
  } catch (reason: unknown) {
    // AI Patch §34: the record itself must survive. A failure here means the
    // canonical write failed, which is a genuine 500.
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法保存饮食记录',
      500,
    )
  }
}
