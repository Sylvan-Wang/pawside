import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const defaults = { day_enabled: true, week_enabled: true, month_enabled: true, generation_mode: 'auto', pin_mode: 'until_read' } as const
const schema = z.object({
  day_enabled: z.boolean(),
  week_enabled: z.boolean(),
  month_enabled: z.boolean(),
  generation_mode: z.enum(['auto', 'manual']),
  pin_mode: z.enum(['until_read', 'three_days']),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const { data, error } = await supabase.from('user_review_settings').select('*').eq('user_id', user.id).maybeSingle()
  if (error) return apiError('DATABASE_ERROR', error.message, 500)
  return NextResponse.json({ data: data ?? defaults })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请检查复盘设置', 422, parsed.error.flatten())
  const { data, error } = await supabase.from('user_review_settings').upsert({ user_id: user.id, ...parsed.data, updated_at: new Date().toISOString() }).select().single()
  if (error) return apiError('DATABASE_ERROR', error.message, 500)
  return NextResponse.json({ data })
}
