import { apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Permanently deletes the signed-in user's account and all of their data.
 *
 * The auth user is removed with the service-role key; every user table cascades
 * from it (see lib/account/user-data.ts). The caller must type their own email as
 * confirmation, so a stray request cannot delete anything.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let body: unknown
  try { body = await request.json() } catch { return apiError('INVALID_JSON', '请求格式不对', 400) }
  const confirmEmail = typeof (body as { confirm_email?: unknown })?.confirm_email === 'string'
    ? (body as { confirm_email: string }).confirm_email.trim().toLowerCase()
    : ''
  if (!user.email || confirmEmail !== user.email.toLowerCase()) {
    return apiError('VALIDATION_ERROR', '输入的邮箱和账号邮箱不一致', 400)
  }

  const admin = createAdminClient()
  if (!admin) {
    return apiError('DATABASE_ERROR', '暂时无法删除账号，请发邮件联系我们处理', 503)
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) return apiError('DATABASE_ERROR', '删除失败，数据没有被改动，请稍后再试或联系我们', 500)

  await supabase.auth.signOut().catch(() => undefined)
  return NextResponse.json({ data: { deleted: true } })
}
