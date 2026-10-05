import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) return apiError('VALIDATION_ERROR', '告警编号无效', 400)

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { error } = await supabase.rpc('resolve_system_alert', { p_id: id })
  if (error) {
    if (error.code === '42501') return apiError('NOT_FOUND', '页面不存在', 404)
    return apiError('DATABASE_ERROR', '暂时无法更新告警', 500)
  }
  return NextResponse.json({ data: { id, status: 'resolved' } })
}
