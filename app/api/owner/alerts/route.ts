import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/** Open and recently resolved system alerts. Owner only (feature owner_console, enforced by RLS). */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data: isOwner, error: ownerError } = await supabase.rpc('feature_enabled', { p_key: 'owner_console' })
  if (ownerError) return apiError('DATABASE_ERROR', '暂时无法读取', 500)
  if (!isOwner) return apiError('NOT_FOUND', '页面不存在', 404)

  const { data, error } = await supabase
    .from('system_alerts')
    .select('id,kind,severity,status,summary,details,repair_prompt,occurrences,first_seen,last_seen,resolved_at')
    .order('status', { ascending: true })
    .order('last_seen', { ascending: false })
    .limit(100)
  if (error) return apiError('DATABASE_ERROR', '暂时无法读取告警', 500)

  return NextResponse.json({ data: { alerts: data ?? [] } })
}
