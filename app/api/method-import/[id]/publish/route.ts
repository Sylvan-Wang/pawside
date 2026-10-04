import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const bodySchema = z.object({ enroll: z.boolean().default(false) })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return apiError('VALIDATION_ERROR', '导入编号无效', 400)
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '发布选项无效', 400)
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const { data, error } = await supabase.rpc('create_private_method_v1', { p_import_id: id })
  if (error) {
    if (error.code === '54000') return apiError('RATE_LIMITED', '最多保留 10 个未隐藏的私有方法', 429)
    return apiError('VALIDATION_ERROR', error.message, 400)
  }
  let enrollment = null
  if (parsed.data.enroll && data?.release_id) {
    const result = await supabase.rpc('enroll_in_method_release_v1', { p_release_id: data.release_id })
    if (result.error) return apiError('DATABASE_ERROR', '方法已保存，但切换失败；可稍后在方法库重试', 500, { published: data })
    enrollment = result.data
  }
  return NextResponse.json({ data: { ...data, enrollment } })
}
