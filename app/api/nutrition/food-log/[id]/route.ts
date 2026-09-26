import { apiError } from '@/lib/api/response'
import { normalizeMealType, replaceFoodLogBodySchema } from '@/lib/nutrition/api-contracts'
import {
  deleteFoodLog,
  replaceFoodLog,
  saveFoodLog,
  type FoodItemInput,
  type MealType,
} from '@/lib/nutrition/persistence'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface LegacyFood {
  name?: string
  weight?: number
  weight_g?: number
  calories?: number | null
  protein_g?: number | null
  carbs_g?: number | null
  fat_g?: number | null
  food_id?: number | null
  is_estimated?: boolean
}

async function clearDerivedCaches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  dates: string[],
) {
  const uniqueDates = [...new Set(dates)]
  if (uniqueDates.length === 0) return
  const { error } = await supabase
    .from('ai_generated_content')
    .delete()
    .eq('user_id', userId)
    .in('target_date', uniqueDates)
    .in('content_type', ['daily_review_ai', 'daily_summary'])
  if (error) throw new Error(error.message)
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data: legacy, error: legacyError } = await supabase
    .from('food_logs')
    .select('id,date,meal_type,foods,notes,updated_at,canonical_food_log_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (legacyError) return apiError('DATABASE_ERROR', legacyError.message, 500)
  if (!legacy) return apiError('NOT_FOUND', '饮食记录不存在', 404)

  const mealType = normalizeMealType(legacy.meal_type)
  if (!mealType) return apiError('CONFLICT', '历史餐别无法识别', 409)

  if (legacy.canonical_food_log_id) {
    const [{ data: canonical, error: canonicalError }, { data: items, error: itemsError }] = await Promise.all([
      supabase
        .from('user_food_logs')
        .select('id,log_date,meal_type,raw_input_text,notes,updated_at')
        .eq('id', legacy.canonical_food_log_id)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('user_food_log_items')
        .select('food_id,food_name_raw,food_name_resolved,weight_g,quantity,unit,is_estimated,energy_kcal,protein_g,carb_g,fat_g')
        .eq('food_log_id', legacy.canonical_food_log_id)
        .neq('status', 'rejected'),
    ])
    if (canonicalError || itemsError || !canonical) {
      return apiError('DATABASE_ERROR', canonicalError?.message || itemsError?.message || '记录读取失败', 500)
    }
    return NextResponse.json({
      data: {
        id: legacy.id,
        canonical_food_log_id: canonical.id,
        date: canonical.log_date,
        meal_type: canonical.meal_type,
        raw_input_text: canonical.raw_input_text,
        notes: canonical.notes,
        updated_at: canonical.updated_at,
        canonical: true,
        items,
      },
    })
  }

  const items = ((legacy.foods ?? []) as LegacyFood[]).map((item) => ({
    food_id: item.food_id ?? null,
    food_name_raw: item.name ?? '',
    food_name_resolved: item.name ?? null,
    weight_g: item.weight_g ?? item.weight ?? null,
    quantity: null,
    unit: 'g',
    is_estimated: item.is_estimated ?? true,
    energy_kcal: item.calories ?? null,
    protein_g: item.protein_g ?? null,
    carb_g: item.carbs_g ?? null,
    fat_g: item.fat_g ?? null,
  }))

  return NextResponse.json({
    data: {
      id: legacy.id,
      canonical_food_log_id: null,
      date: legacy.date,
      meal_type: mealType,
      raw_input_text: null,
      notes: legacy.notes,
      updated_at: legacy.updated_at,
      canonical: false,
      items,
    },
  })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }
  const parsed = replaceFoodLogBodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '请检查饮食记录内容', 422, parsed.error.flatten())
  }

  const { data: legacy, error: legacyError } = await supabase
    .from('food_logs')
    .select('date,updated_at,canonical_food_log_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (legacyError) return apiError('DATABASE_ERROR', legacyError.message, 500)
  if (!legacy) return apiError('NOT_FOUND', '饮食记录不存在', 404)

  const body = parsed.data
  try {
    if (!legacy.canonical_food_log_id && body.expected_updated_at
      && legacy.updated_at !== body.expected_updated_at) {
      return apiError('CONFLICT', '记录已在其他页面更新，请刷新后重试', 409)
    }

    const common = {
      userId: user.id,
      logDate: body.date,
      mealType: body.meal_type as MealType,
      rawInputText: body.raw_input_text ?? null,
      notes: body.notes ?? null,
      items: body.items as FoodItemInput[],
    }
    const result = legacy.canonical_food_log_id
      ? await replaceFoodLog(supabase, {
          ...common,
          foodLogId: legacy.canonical_food_log_id,
          expectedUpdatedAt: body.expected_updated_at ?? null,
        })
      : await saveFoodLog(supabase, {
          ...common,
          requestId: body.request_id,
          legacyFoodLogId: id,
        })

    const oldDate = 'oldLogDate' in result ? String(result.oldLogDate) : String(legacy.date)
    const newDate = String(body.date)
    await clearDerivedCaches(supabase, user.id, [oldDate, newDate])
    return NextResponse.json({
      data: {
        food_log_id: result.foodLogId,
        legacy_food_log_id: result.legacyFoodLogId,
        affected_dates: [...new Set([oldDate, newDate])],
        items: result.items,
        has_estimated_items: result.hasEstimatedItems,
      },
    })
  } catch (reason: unknown) {
    const message = reason instanceof Error ? reason.message : '暂时无法更新饮食记录'
    if (message.includes('updated by another request')) {
      return apiError('CONFLICT', '记录已在其他页面更新，请刷新后重试', 409)
    }
    return apiError('DATABASE_ERROR', message, 500)
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  try {
    const result = await deleteFoodLog(supabase, id)
    await clearDerivedCaches(supabase, user.id, [result.logDate])
    return NextResponse.json({ data: result })
  } catch (reason: unknown) {
    const message = reason instanceof Error ? reason.message : '暂时无法删除饮食记录'
    if (message.includes('not found')) return apiError('NOT_FOUND', '饮食记录不存在', 404)
    return apiError('DATABASE_ERROR', message, 500)
  }
}
