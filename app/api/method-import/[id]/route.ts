import { apiError } from '@/lib/api/response'
import { MethodManifestSchema } from '@/lib/contracts/method/manifest'
import { verifyManifestSource } from '@/lib/method-import/verify'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()
const patchSchema = z.object({
  manifest_draft: MethodManifestSchema.optional(),
  status: z.enum(['draft', 'extracting', 'review', 'failed', 'discarded']).optional(),
}).refine((value) => Object.keys(value).length > 0)

async function context(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, item: null }
  const { data: item } = await supabase.from('user_method_imports').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  return { supabase, user, item }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) return apiError('VALIDATION_ERROR', '导入编号无效', 400)
  const { user, item } = await context(id)
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  if (!item) return apiError('NOT_FOUND', '导入草稿不存在', 404)
  return NextResponse.json({ data: item })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) return apiError('VALIDATION_ERROR', '导入编号无效', 400)
  const { supabase, user, item } = await context(id)
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  if (!item) return apiError('NOT_FOUND', '导入草稿不存在', 404)
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '修改内容无效', 400, parsed.error.flatten())
  const manifest = parsed.data.manifest_draft
  if (manifest) {
    const issues = verifyManifestSource(item.raw_text, manifest)
    if (issues.length > 0) return apiError('VALIDATION_ERROR', '原文明写的数据必须保留有效引用', 422, { issues })
  }
  const { data, error } = await supabase.from('user_method_imports').update({
    ...parsed.data,
    open_questions_count: manifest?.openQuestions.length ?? item.open_questions_count,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('user_id', user.id).select('*').single()
  if (error) return apiError('DATABASE_ERROR', '导入草稿更新失败', 500)
  return NextResponse.json({ data })
}
