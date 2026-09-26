import { apiError } from '@/lib/api/response'
import {
  dailyCalorieTargetBounds,
  onboardingGenders,
  onboardingGoals,
  onboardingWeightUnits,
  weeklyWorkoutTargetBounds,
} from '@/lib/contracts/onboarding'
import { buildNutritionTargetSnapshot } from '@/lib/nutrition/targets'
import { createClient } from '@/lib/supabase/server'
import { invalidateDayDerivedCache, today } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const bodySchema = z.object({
  gender: z.enum(onboardingGenders),
  height_cm: z.number().positive().max(300),
  weight_kg: z.number().positive().max(500),
  weight_unit: z.enum(onboardingWeightUnits),
  goal: z.enum(onboardingGoals),
  weekly_workout_target: z.number().int()
    .min(weeklyWorkoutTargetBounds.min)
    .max(weeklyWorkoutTargetBounds.max)
    .nullable(),
  daily_calorie_target: z.number().int()
    .min(dailyCalorieTargetBounds.min)
    .max(dailyCalorieTargetBounds.max)
    .nullable(),
  time_zone: z.string().trim().min(1).max(100),
})

export async function PATCH(request: NextRequest) {
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
    return apiError('VALIDATION_ERROR', '请检查设置内容', 422, parsed.error.flatten())
  }

  let effectiveDate: string
  try {
    effectiveDate = today(parsed.data.time_zone)
  } catch {
    return apiError('VALIDATION_ERROR', '时区无效', 422)
  }

  const { data: latestMetric, error: metricError } = await supabase
    .from('body_metrics')
    .select('weight_kg,date')
    .eq('user_id', user.id)
    .not('weight_kg', 'is', null)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (metricError) return apiError('DATABASE_ERROR', metricError.message, 500)

  const targetWeightKg = latestMetric?.weight_kg == null
    ? parsed.data.weight_kg
    : Number(latestMetric.weight_kg)
  const snapshot = buildNutritionTargetSnapshot({
    dailyCalorieTargetKcal: parsed.data.daily_calorie_target,
    weightKg: targetWeightKg,
  })

  const { data, error } = await supabase.rpc('update_profile_targets_v1', {
    p_gender: parsed.data.gender,
    p_height_cm: parsed.data.height_cm,
    p_weight_kg: parsed.data.weight_kg,
    p_weight_unit: parsed.data.weight_unit,
    p_goal: parsed.data.goal,
    p_weekly_workout_target: parsed.data.weekly_workout_target,
    p_daily_calorie_target: parsed.data.daily_calorie_target,
    p_target_effective_date: effectiveDate,
    p_protein_target_g: snapshot.target.protein_g,
    p_carb_target_g: snapshot.target.carbs_g,
    p_fat_target_g: snapshot.target.fat_g,
    p_target_source: snapshot.source,
    p_macro_target_status: snapshot.macroTargetStatus,
    p_target_calculation_basis: snapshot.calculationBasis,
    p_target_evidence_ref_ids: snapshot.evidenceRefIds,
  })
  if (error || !data) {
    return apiError('DATABASE_ERROR', error?.message || '设置保存失败', 500)
  }

  const invalidation = await invalidateDayDerivedCache(supabase, user.id, effectiveDate)
  return NextResponse.json({
    data: {
      result: data,
      nutrition_target: snapshot,
      target_weight_source: latestMetric ? 'latest_body_metric' : 'profile_weight',
      affected_dates: [effectiveDate],
      cache_invalidation: invalidation,
    },
  })
}
