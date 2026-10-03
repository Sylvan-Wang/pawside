import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) return apiError('VALIDATION_ERROR', '训练记录编号无效', 400)

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data: log, error: readError } = await supabase
    .from('workout_logs')
    .select('id,method_workout_session_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (readError) return apiError('DATABASE_ERROR', '暂时无法读取训练记录', 500)
  if (!log) return apiError('NOT_FOUND', '训练记录不存在', 404)

  if (log.method_workout_session_id) {
    const { data: enabled } = await supabase.rpc('feature_enabled', { p_key: 'multi_day_runtime' })
    if (enabled) {
      const { data: deleted, error } = await supabase.rpc('soft_delete_workout_session_v1', {
        p_session_id: log.method_workout_session_id,
      })
      if (error || !deleted) return apiError('DATABASE_ERROR', '暂时无法删除训练记录', 500)
    }
  }

  const { error: deleteError } = await supabase.from('workout_logs').delete().eq('id', id).eq('user_id', user.id)
  if (deleteError) return apiError('DATABASE_ERROR', '暂时无法删除训练记录', 500)
  return NextResponse.json({ data: { deleted: true } })
}
