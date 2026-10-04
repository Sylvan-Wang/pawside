import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({ tier: z.enum(['day', 'week', 'month']), period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请检查复盘周期', 422)
  const { error } = await supabase.from('user_review_reads').upsert({ user_id: user.id, ...parsed.data, read_at: new Date().toISOString() })
  if (error) return apiError('DATABASE_ERROR', error.message, 500)
  return NextResponse.json({ data: { read: true } })
}
