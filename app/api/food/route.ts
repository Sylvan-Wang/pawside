import { saveFoodLog, type FoodItemInput, type MealType } from '@/lib/nutrition/persistence'
import { createClient } from '@/lib/supabase/server'
import { invalidateDayDerivedCache } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const legacyMealTypes: Record<string, MealType> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'snack',
  早餐: 'breakfast',
  午餐: 'lunch',
  晚餐: 'dinner',
  加餐: 'snack',
}

const legacyBodySchema = z.object({
  request_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.string().min(1),
  foods: z.array(z.object({
    food_id: z.number().int().positive().nullable().optional(),
    name: z.string().trim().min(1),
    weight_g: z.coerce.number().positive().optional(),
    weight: z.coerce.number().positive().optional(),
    calories: z.coerce.number().nonnegative().nullable().optional(),
    protein_g: z.coerce.number().nonnegative().nullable().optional(),
    carbs_g: z.coerce.number().nonnegative().nullable().optional(),
    fat_g: z.coerce.number().nonnegative().nullable().optional(),
  })).min(1),
})

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
  const parsed = legacyBodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: '请填写必要信息' }, { status: 422 })

  const mealType = legacyMealTypes[parsed.data.meal_type]
  if (!mealType) return NextResponse.json({ error: '餐别无效' }, { status: 422 })

  const items: FoodItemInput[] = parsed.data.foods.map((food) => ({
    food_id: food.food_id ?? null,
    food_name_raw: food.name,
    food_name_resolved: food.name,
    weight_g: food.weight_g ?? food.weight ?? 0,
    resolution_source: food.food_id ? 'canonical_db' : 'user_override',
    source_ref_id: food.food_id ? String(food.food_id) : null,
    user_confirmed: true,
    per100g: null,
    fallback: food.food_id ? undefined : {
      calories_kcal: food.calories ?? null,
      protein_g: food.protein_g ?? null,
      carbs_g: food.carbs_g ?? null,
      fat_g: food.fat_g ?? null,
    },
  }))

  try {
    const result = await saveFoodLog(supabase, {
      userId: user.id,
      requestId: parsed.data.request_id ?? crypto.randomUUID(),
      logDate: parsed.data.date,
      mealType,
      rawInputText: null,
      notes: null,
      items,
    })
    const cacheInvalidation = await invalidateDayDerivedCache(
      supabase,
      user.id,
      parsed.data.date,
    )
    return NextResponse.json({
      success: true,
      message: '保存成功',
      data: {
        food_log_id: result.foodLogId,
        legacy_food_log_id: result.legacyFoodLogId,
        idempotent: result.idempotent,
        cache_invalidation: cacheInvalidation,
      },
    })
  } catch (reason: unknown) {
    return NextResponse.json({
      error: reason instanceof Error ? reason.message : '保存失败',
    }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  let query = supabase.from('food_logs').select('*').eq('user_id', user.id)
  if (date) query = query.eq('date', date)
  else if (start && end) query = query.gte('date', start).lte('date', end)

  const { data, error } = await query.order('date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
