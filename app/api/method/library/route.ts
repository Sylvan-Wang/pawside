import { apiError } from '@/lib/api/response'
import { methodShortName } from '@/lib/method-display'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface RawSplit {
  key: string
  name_zh: string
  order_index: number
  is_required: boolean
  day_type: string
  exercises: { id: string }[] | null
}

interface RawRelease {
  id: string
  version: string
  activated_at: string | null
  method: { key: string; name: string; description: string | null } | { key: string; name: string; description: string | null }[] | null
  splits: RawSplit[] | null
}

/**
 * The methods a user can switch between: every active Method release (readable by
 * any signed-in user through RLS), plus which one the user is on now.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const [{ data: enrollment, error: enrollmentError }, { data: releases, error: releasesError }] = await Promise.all([
    supabase
      .from('method_enrollments')
      .select('method_release_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('method_releases')
      .select('id,version,activated_at,method:methods(key,name,description),splits:method_splits(key,name_zh,order_index,is_required,day_type,exercises:method_split_exercises(id))')
      .eq('status', 'active')
      .eq('runtime_gate_status', 'passed')
      .order('activated_at', { ascending: true }),
  ])
  if (enrollmentError || releasesError) return apiError('DATABASE_ERROR', '暂时无法读取训练方法', 500)

  const currentReleaseId = enrollment?.method_release_id ?? null
  const methods = ((releases ?? []) as unknown as RawRelease[]).map((release) => {
    const method = Array.isArray(release.method) ? release.method[0] : release.method
    const days = [...(release.splits ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((split) => ({
        key: split.key,
        name_zh: split.name_zh,
        required: split.is_required,
        day_type: split.day_type,
        exercise_count: split.exercises?.length ?? 0,
      }))
    return {
      release_id: release.id,
      method_key: method?.key ?? null,
      short_name: methodShortName(method?.key, method?.name),
      name: method?.name ?? null,
      description: method?.description ?? null,
      version: release.version,
      is_current: release.id === currentReleaseId,
      days,
    }
  })

  return NextResponse.json({ data: { current_release_id: currentReleaseId, methods } })
}
