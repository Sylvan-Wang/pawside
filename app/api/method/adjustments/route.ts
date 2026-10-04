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

async function importedSubstitutions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  enrollmentId: string | null,
  exerciseId: string | null,
) {
  if (!enrollmentId || !exerciseId) return []
  const { data: enrollment, error: enrollmentError } = await supabase.from('method_enrollments')
    .select('method_release_id').eq('id', enrollmentId).eq('user_id', userId).maybeSingle()
  if (enrollmentError) throw new Error(enrollmentError.message)
  if (!enrollment?.method_release_id) return []
  const { data: splits, error: splitError } = await supabase.from('method_splits')
    .select('id').eq('method_release_id', enrollment.method_release_id)
  if (splitError) throw new Error(splitError.message)
  const splitIds = (splits ?? []).map((split) => split.id)
  if (splitIds.length === 0) return []
  const { data: entries, error: entryError } = await supabase.from('method_split_exercises')
    .select('substitution_rule_key').in('method_split_id', splitIds).eq('exercise_id', exerciseId)
    .not('substitution_rule_key', 'is', null)
  if (entryError) throw new Error(entryError.message)
  const ruleKeys = [...new Set((entries ?? []).map((entry) => entry.substitution_rule_key).filter(Boolean))]
  if (ruleKeys.length === 0) return []
  const { data: rules, error: ruleError } = await supabase.from('method_rules')
    .select('config_json').eq('method_release_id', enrollment.method_release_id).in('rule_key', ruleKeys)
  if (ruleError) throw new Error(ruleError.message)
  const refs = (rules ?? []).flatMap((rule) => {
    const config = rule.config_json as { candidates?: unknown } | null
    return Array.isArray(config?.candidates) ? config.candidates : []
  }).filter((candidate): candidate is { exerciseId: string; name: string } => {
    if (!candidate || typeof candidate !== 'object') return false
    const value = candidate as Record<string, unknown>
    return typeof value.exerciseId === 'string' && uuid.safeParse(value.exerciseId).success && typeof value.name === 'string'
  })
  const ids = [...new Set(refs.map((ref) => ref.exerciseId))]
  if (ids.length === 0) return []
  const { data: exercises, error: exerciseError } = await supabase.from('exercises')
    .select('id,canonical_name_zh').in('id', ids)
  if (exerciseError) throw new Error(exerciseError.message)
  const names = new Map((exercises ?? []).map((exercise) => [exercise.id, exercise.canonical_name_zh]))
  return refs.filter((ref) => names.has(ref.exerciseId)).map((ref) => ({
    kind: 'method', note: '原方法提供的替代动作',
    substitute: { id: ref.exerciseId, canonical_name_zh: names.get(ref.exerciseId) ?? ref.name },
  }))
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
  let methodSubstitutions: Awaited<ReturnType<typeof importedSubstitutions>> = []
  try {
    methodSubstitutions = await importedSubstitutions(supabase, user.id, enrollmentId, exerciseId)
  } catch {
    return apiError('DATABASE_ERROR', '暂时无法读取方法替代动作', 500)
  }
  const seen = new Set<string>()
  const merged = [...(substitutions.data ?? []), ...methodSubstitutions].filter((item) => {
    const relation = Array.isArray(item.substitute) ? item.substitute[0] : item.substitute
    if (!relation?.id || seen.has(relation.id)) return false
    seen.add(relation.id)
    return true
  })
  return NextResponse.json({ data: { adjustments: adjustments.data ?? [], substitutions: merged } })
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
