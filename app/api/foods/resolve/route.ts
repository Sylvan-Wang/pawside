import { apiError } from '@/lib/api/response'
import {
  confirmFoodNutrition,
  estimateFoodPer100g,
  searchFoodCandidates,
} from '@/lib/nutrition/food-resolver'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * Food resolution endpoint for the food page. The matching, estimating and
 * confirming logic lives in lib/nutrition/food-resolver.ts so the chat
 * assistant uses exactly the same code (no second implementation).
 */

const coreNutritionSchema = z.object({
  energy_kcal: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carb_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative().nullable().optional(),
})

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('estimate'),
    name: z.string().trim().min(1).max(160),
  }),
  z.object({
    action: z.literal('confirm'),
    name: z.string().trim().min(1).max(160),
    brand: z.string().trim().max(120).nullable().optional(),
    source: z.enum(['ai_estimate', 'user_override']),
    weight_g: z.number().positive().max(100_000),
    actual: coreNutritionSchema,
    confidence: z.number().min(0).max(1).nullable().optional(),
  }),
])

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (!query) return NextResponse.json({ data: [] })

  const result = await searchFoodCandidates(supabase, user.id, query)
  if (!result.ok) return apiError('DATABASE_ERROR', '暂时无法解析食物', 500)
  return NextResponse.json({ data: result.data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请检查食物解析内容', 422)

  if (parsed.data.action === 'estimate') {
    const result = await estimateFoodPer100g(parsed.data.name)
    if (!result.ok) {
      return apiError(
        result.reason === 'not_configured' ? 'AI_NOT_CONFIGURED' : 'AI_PROVIDER_ERROR',
        'AI 暂时不可用，你仍可手动填写营养信息',
        503,
      )
    }
    return NextResponse.json({
      data: {
        source: 'ai_estimate',
        provisional: true,
        nutrition: { basis_type: 'per_100g', ...result.data },
        model: result.model,
      },
    })
  }

  const confirmed = await confirmFoodNutrition(supabase, user.id, {
    name: parsed.data.name,
    brand: parsed.data.brand,
    source: parsed.data.source,
    weight_g: parsed.data.weight_g,
    actual: parsed.data.actual,
    confidence: parsed.data.confidence,
  })
  if (!confirmed.ok) {
    return apiError(
      'DATABASE_ERROR',
      confirmed.error === 'candidate' ? '暂时无法保存确认结果' : '暂时无法保存个人食物记录',
      500,
    )
  }
  return NextResponse.json({ data: confirmed.data })
}
