import { createHash } from 'node:crypto'
import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const HEALTH_CONSENT_VERSION = 'health-v1'
const createSchema = z.object({
  raw_text: z.string().trim().min(1).max(30000),
  consent_accepted: z.literal(true),
  consent_version: z.literal(HEALTH_CONSENT_VERSION),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const { data: enabled } = await supabase.rpc('feature_enabled', { p_key: 'method_import' })
  if (enabled !== true) return apiError('VALIDATION_ERROR', '方法导入尚未为此账号开放', 403)
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请粘贴训练文章并勾选健康声明', 400, parsed.error.flatten())
  const checksum = createHash('sha256').update(parsed.data.raw_text, 'utf8').digest('hex')
  const { data, error } = await supabase.from('user_method_imports').insert({
    user_id: user.id, raw_text: parsed.data.raw_text, text_checksum_sha256: checksum,
    consent_version: parsed.data.consent_version, consented_at: new Date().toISOString(), status: 'draft',
  }).select('id,status,created_at').single()
  if (error?.code === '54000' || error?.message.includes('Import limit reached')) {
    return apiError('RATE_LIMITED', '24 小时内最多导入 5 次，请稍后再试', 429)
  }
  if (error) return apiError('DATABASE_ERROR', '导入草稿保存失败', 500)
  return NextResponse.json({ data }, { status: 201 })
}
