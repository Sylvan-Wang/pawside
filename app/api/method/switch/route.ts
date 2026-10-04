import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SwitchResult {
  status: 'switched' | 'unchanged'
  enrollment_id: string
  method_release_id: string
  method_name?: string
  next_split_key?: string
}

/**
 * Switch the signed-in user's training method. All work happens in the
 * switch_method_release_v1 RPC (one transaction, never deletes training history).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求格式无效', 400)
  }
  const releaseId = (body as { method_release_id?: unknown } | null)?.method_release_id
  if (typeof releaseId !== 'string' || !UUID_PATTERN.test(releaseId)) {
    return apiError('VALIDATION_ERROR', '训练方法无效', 400)
  }

  const { data, error } = await supabase.rpc('switch_method_release_v1', { p_release_id: releaseId })
  if (error) {
    if (error.code === '55000') {
      return apiError('CONFLICT', '还有一条进行中的训练，请先完成或退出后再切换。', 409)
    }
    if (error.code === 'P0002') {
      return apiError('NOT_FOUND', '这个训练方法暂时不可用。', 404)
    }
    return apiError('DATABASE_ERROR', '暂时无法切换训练方法', 500)
  }
  if (!data) return apiError('DATABASE_ERROR', '暂时无法切换训练方法', 500)

  const result = data as SwitchResult
  return NextResponse.json({
    data: result,
    message: result.status === 'unchanged' ? '已经是当前的训练方法。' : '已切换训练方法。',
  })
}
