import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const uuid = z.string().uuid()
const createSchema = z.object({
  enrollment_id: uuid,
  split_key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  exercise_id: uuid,
  action: z.enum(['hide_exercise', 'swap_exercise', 'set_count', 'rep_range']),
  payload: z.record(z.string(), z.unknown()).default({}),
  scope: z.enum(['future', 'once']),
})

async function authenticatedClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { supabase, user: error ? null : user }
}

export async function GET(request: Request) {
  const { supabase, user } = await authenticatedClient()
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const url = new URL(request.url)
  const exerciseId = url.searchParams.get('exercise_id')
  let enrollmentId = url.searchParams.get('enrollment_id')
  if (exerciseId && !uuid.safeParse(exerciseId).success) return apiError('VALIDATION_ERROR', '动作编号无效', 400)
  if (enrollmentId && !uuid.safeParse(enrollmentId).success) return apiError('VALIDATION_ERROR', '方法报名编号无效', 400)
  if (!enrollmentId) {
    const { data: enrollment } = await supabase.from('method_enrollments')
      .select('id').eq('user_id', user.id).eq('status', 'active')
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    enrollmentId = enrollment?.id ?? null
  }

  const [adjustments, substitutions] = await Promise.all([
    enrollmentId
      ? supabase.from('user_method_adjustments')
          .select('id,split_key,exercise_id,action,payload,created_at')
          .eq('enrollment_id', enrollmentId)
          .is('revoked_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    exerciseId
      ? supabase.from('exercise_substitutions')
          .select('kind,note,substitute:exercises!exercise_substitutions_substitute_exercise_id_fkey(id,canonical_name_zh)')
          .eq('exercise_id', exerciseId)
          .eq('review_status', 'reviewed')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (adjustments.error || substitutions.error) return apiError('DATABASE_ERROR', '暂时无法读取调整', 500)
  return NextResponse.json({ data: { adjustments: adjustments.data ?? [], substitutions: substitutions.data ?? [] } })
}

export async function POST(request: Request) {
  const { supabase, user } = await authenticatedClient()
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '调整内容无效', 400, parsed.error.flatten())
  const value = parsed.data
  const { data, error } = await supabase.rpc('apply_adjustment_v1', {
    p_enrollment_id: value.enrollment_id,
    p_split_key: value.split_key,
    p_exercise_id: value.exercise_id,
    p_action: value.action,
    p_payload: value.payload,
    p_scope: value.scope,
  })
  if (error) return apiError('VALIDATION_ERROR', error.message, 400)
  return NextResponse.json({ data: { adjustment_id: data } }, { status: 201 })
}

export async function DELETE(request: Request) {
  const { supabase, user } = await authenticatedClient()
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const id = new URL(request.url).searchParams.get('id')
  if (!id || !uuid.safeParse(id).success) return apiError('VALIDATION_ERROR', '调整编号无效', 400)
  const { data, error } = await supabase.rpc('revoke_adjustment_v1', { p_adjustment_id: id })
  if (error) return apiError('VALIDATION_ERROR', error.message, 400)
  if (!data) return apiError('NOT_FOUND', '调整不存在', 404)
  return NextResponse.json({ data: { revoked: true } })
}
