import { apiError } from '@/lib/api/response'
import { evaluateMethodEquipmentFit } from '@/lib/method-availability'
import { methodDescription, methodShortName } from '@/lib/method-display'
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

interface RawMethod {
  key: string
  name: string
  description: string | null
  required_equipment: string | null
}

interface RawRelease {
  id: string
  version: string
  activated_at: string | null
  method: RawMethod | RawMethod[] | null
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

  const [
    { data: enrollment, error: enrollmentError },
    { data: releases, error: releasesError },
    { data: capability, error: capabilityError },
  ] = await Promise.all([
    supabase
      .from('method_enrollments')
      .select('method_release_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('method_releases')
      .select('id,version,activated_at,method:methods(key,name,description,required_equipment),splits:method_splits(key,name_zh,order_index,is_required,day_type,exercises:method_split_exercises(id))')
      .eq('status', 'active')
      .eq('runtime_gate_status', 'passed')
      .order('activated_at', { ascending: true }),
    supabase
      .from('onboarding_capability_profiles')
      .select('equipment_access')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  if (enrollmentError || releasesError || capabilityError) return apiError('DATABASE_ERROR', '暂时无法读取训练方法', 500)

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
    const equipmentFit = evaluateMethodEquipmentFit(capability?.equipment_access, method?.required_equipment)
    return {
      release_id: release.id,
      method_key: method?.key ?? null,
      short_name: methodShortName(method?.key, method?.name),
      name: method?.name ?? null,
      description: methodDescription(method?.key, method?.description),
      version: release.version,
      is_current: release.id === currentReleaseId,
      required_equipment: method?.required_equipment ?? 'full_gym',
      equipment_fit: equipmentFit.fit,
      equipment_requirement_label: equipmentFit.requirement_label,
      equipment_message: equipmentFit.message,
      days,
    }
  })

  // Every method is listed. The current one first, then the ones the user's equipment
  // fits, then the rest (shown greyed out by the client). Sort is stable within a group.
  const rank = (method: { is_current: boolean; equipment_fit: string }) =>
    method.is_current ? 0 : method.equipment_fit === 'available' ? 1 : 2
  methods.sort((a, b) => rank(a) - rank(b))

  return NextResponse.json({ data: { current_release_id: currentReleaseId, methods } })
}
