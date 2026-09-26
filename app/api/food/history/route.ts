import { apiError } from '@/lib/api/response'
import { buildFoodHistorySuggestions } from '@/lib/food-history'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get('limit') ?? '8'
  const limit = Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return apiError('VALIDATION_ERROR', '历史食物数量无效', 400)
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data, error } = await supabase
    .from('food_logs')
    .select('id,foods,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return apiError('DATABASE_ERROR', '暂时无法读取历史食物', 500)

  return NextResponse.json({
    data: buildFoodHistorySuggestions(data ?? [], limit),
  })
}
