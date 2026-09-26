import { apiError } from '@/lib/api/response'
import { callStructuredOutput } from '@/lib/ai-client'
import {
  actualToPer100g,
  normalizeFoodName,
  type ResolutionSource,
} from '@/lib/nutrition/food-resolution'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

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

const estimateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    energy_kcal: { type: 'number', minimum: 0 },
    protein_g: { type: 'number', minimum: 0 },
    carb_g: { type: 'number', minimum: 0 },
    fat_g: { type: 'number', minimum: 0 },
    fiber_g: { type: ['number', 'null'], minimum: 0 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    caveat: { type: 'string', maxLength: 120 },
  },
  required: ['energy_kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g', 'confidence', 'caveat'],
} as const

interface EstimatePayload {
  energy_kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
  fiber_g: number | null
  confidence: number
  caveat: string
}

function validEstimate(value: unknown): value is EstimatePayload {
  return z.object({
    energy_kcal: z.number().nonnegative(),
    protein_g: z.number().nonnegative(),
    carb_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    fiber_g: z.number().nonnegative().nullable(),
    confidence: z.number().min(0).max(1),
    caveat: z.string(),
  }).safeParse(value).success
}

function nutrition(row: Record<string, unknown>) {
  return {
    basis_type: 'per_100g',
    energy_kcal: row.energy_kcal_per_100g == null ? null : Number(row.energy_kcal_per_100g),
    protein_g: row.protein_g_per_100g == null ? null : Number(row.protein_g_per_100g),
    carb_g: row.carb_g_per_100g == null ? null : Number(row.carb_g_per_100g),
    fat_g: row.fat_g_per_100g == null ? null : Number(row.fat_g_per_100g),
    fiber_g: row.fiber_g_per_100g == null ? null : Number(row.fiber_g_per_100g),
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (!query) return NextResponse.json({ data: [] })
  const normalized = normalizeFoodName(query)

  const [memoryResult, canonicalResult, aliasResult, candidateResult] = await Promise.all([
    supabase.from('user_food_memory')
      .select('id,raw_name,normalized_name,energy_kcal_per_100g,protein_g_per_100g,carb_g_per_100g,fat_g_per_100g,fiber_g_per_100g')
      .eq('user_id', user.id).ilike('normalized_name', `%${normalized}%`).limit(5),
    supabase.from('foods')
      .select('id,canonical_name,food_nutrition(basis_type,energy_kcal,protein_g,carb_g,fat_g,fiber_g)')
      .eq('is_active', true).ilike('canonical_name', `%${query}%`).limit(10),
    supabase.from('food_aliases')
      .select('alias,foods(id,canonical_name,food_nutrition(basis_type,energy_kcal,protein_g,carb_g,fat_g,fiber_g))')
      .ilike('alias', `%${query}%`).limit(10),
    supabase.from('food_resolution_candidates')
      .select('id,raw_name,normalized_name,energy_kcal_per_100g,protein_g_per_100g,carb_g_per_100g,fat_g_per_100g,fiber_g_per_100g,source_type')
      .neq('status', 'rejected').gt('confirm_count', 0)
      .ilike('normalized_name', `%${normalized}%`).limit(5),
  ])

  const databaseError = memoryResult.error || canonicalResult.error || aliasResult.error || candidateResult.error
  if (databaseError) return apiError('DATABASE_ERROR', '暂时无法解析食物', 500)

  const results: Array<Record<string, unknown>> = []
  for (const row of memoryResult.data ?? []) {
    results.push({
      source: 'user_memory' satisfies ResolutionSource,
      source_ref_id: row.id,
      name: row.raw_name,
      matched_alias: null,
      food_id: null,
      nutrition: nutrition(row),
      user_confirmed: true,
    })
  }

  const seenCanonical = new Set<number>()
  const addCanonical = (food: Record<string, unknown>, matchedAlias: string | null) => {
    const id = Number(food.id)
    if (!Number.isInteger(id) || seenCanonical.has(id)) return
    seenCanonical.add(id)
    const relation = food.food_nutrition
    const value = Array.isArray(relation) ? relation[0] : relation
    results.push({
      source: 'canonical_db' satisfies ResolutionSource,
      source_ref_id: String(id),
      name: String(food.canonical_name),
      matched_alias: matchedAlias,
      food_id: id,
      nutrition: value ?? null,
      user_confirmed: true,
    })
  }
  for (const food of canonicalResult.data ?? []) addCanonical(food as unknown as Record<string, unknown>, null)
  for (const row of aliasResult.data ?? []) {
    if (row.foods) addCanonical(row.foods as unknown as Record<string, unknown>, row.alias)
  }

  for (const row of candidateResult.data ?? []) {
    results.push({
      source: 'candidate_cache' satisfies ResolutionSource,
      source_ref_id: row.id,
      name: row.raw_name,
      matched_alias: null,
      food_id: null,
      nutrition: nutrition(row),
      user_confirmed: true,
    })
  }

  return NextResponse.json({ data: results.slice(0, 15) })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请检查食物解析内容', 422)

  if (parsed.data.action === 'estimate') {
    const result = await callStructuredOutput<EstimatePayload>(
      'Estimate a typical per-100g nutrition profile for the named food. Return a provisional estimate only. Do not claim a brand, database match, or medical certainty. All numeric fields must describe 100 grams.',
      JSON.stringify({ food_name: parsed.data.name, basis: 'per_100g' }),
      'pawside_food_estimate_v1',
      estimateSchema,
      validEstimate,
      300,
    )
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

  const per100g = actualToPer100g({
    weightG: parsed.data.weight_g,
    energyKcal: parsed.data.actual.energy_kcal,
    proteinG: parsed.data.actual.protein_g,
    carbG: parsed.data.actual.carb_g,
    fatG: parsed.data.actual.fat_g,
    fiberG: parsed.data.actual.fiber_g,
  })
  const normalizedName = normalizeFoodName(parsed.data.name)
  let candidateId: string | null = null

  if (parsed.data.source === 'ai_estimate') {
    const { data: candidate, error } = await supabase.from('food_resolution_candidates').insert({
      created_by: user.id,
      normalized_name: normalizedName,
      raw_name: parsed.data.name,
      brand: parsed.data.brand ?? null,
      energy_kcal_per_100g: per100g.energy_kcal,
      protein_g_per_100g: per100g.protein_g,
      carb_g_per_100g: per100g.carb_g,
      fat_g_per_100g: per100g.fat_g,
      fiber_g_per_100g: per100g.fiber_g ?? null,
      source_type: 'ai_estimate',
      confidence: parsed.data.confidence ?? null,
      source_detail: { confirmation: 'explicit_user_action', basis_type: 'per_100g' },
    }).select('id').single()
    if (error) return apiError('DATABASE_ERROR', '暂时无法保存确认结果', 500)
    candidateId = candidate.id
  }

  const { data: memory, error: memoryError } = await supabase.from('user_food_memory').upsert({
    user_id: user.id,
    normalized_name: normalizedName,
    raw_name: parsed.data.name,
    brand: parsed.data.brand ?? null,
    energy_kcal_per_100g: per100g.energy_kcal,
    protein_g_per_100g: per100g.protein_g,
    carb_g_per_100g: per100g.carb_g,
    fat_g_per_100g: per100g.fat_g,
    fiber_g_per_100g: per100g.fiber_g ?? null,
    source_type: parsed.data.source,
    source_ref_id: candidateId,
    last_confirmed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,normalized_name' }).select('id').single()

  if (memoryError) return apiError('DATABASE_ERROR', '暂时无法保存个人食物记录', 500)
  return NextResponse.json({
    data: {
      source: parsed.data.source,
      source_ref_id: candidateId ?? memory.id,
      memory_id: memory.id,
      nutrition: per100g,
      user_confirmed: true,
    },
  })
}
