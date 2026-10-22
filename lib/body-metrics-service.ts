import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bodyMetricNumberFields,
  type BodyMetricsInput,
} from '@/lib/contracts/body-metrics'
import { buildNutritionTargetSnapshot, targetSnapshotRpcArgs } from '@/lib/nutrition/targets'
import { dateKeyInTimeZone, invalidateDayDerivedCache } from '@/lib/utils'

/**
 * Body-metric writes, shared by POST /api/body-metrics and the chat assistant.
 * The behaviour is the route's, moved here unchanged so both callers go through
 * one idempotent write (save_body_metric_with_target_v1).
 */

export type SaveBodyMetricResult =
  | {
      ok: true
      id: string
      idempotent: boolean
      affectedDates: string[]
      cacheInvalidation: Awaited<ReturnType<typeof invalidateDayDerivedCache>>
    }
  | { ok: false; status: number; message: string }

export async function saveBodyMetric(
  supabase: SupabaseClient,
  userId: string,
  input: { requestId: string; timeZone: string; metric: BodyMetricsInput; now?: Date },
): Promise<SaveBodyMetricResult> {
  let targetEffectiveDate: string
  try {
    targetEffectiveDate = dateKeyInTimeZone(input.now ?? new Date(), input.timeZone)
  } catch {
    return { ok: false, status: 400, message: 'time_zone 无效' }
  }

  const [{ data: profile, error: profileError }, { data: latestMetric, error: metricError }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('daily_calorie_target,weight_kg')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('body_metrics')
      .select('date,weight_kg')
      .eq('user_id', userId)
      .not('weight_kg', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (profileError || metricError) {
    return { ok: false, status: 500, message: '读取目标依据失败' }
  }

  const candidateIsLatest = input.metric.weight_kg !== null
    && (!latestMetric?.date || input.metric.date >= String(latestMetric.date))
  const targetWeightKg = candidateIsLatest
    ? input.metric.weight_kg
    : latestMetric?.weight_kg != null
      ? Number(latestMetric.weight_kg)
      : profile?.weight_kg != null
        ? Number(profile.weight_kg)
        : null
  const calorieTarget = profile?.daily_calorie_target == null
    ? null
    : Number(profile.daily_calorie_target)
  const snapshot = buildNutritionTargetSnapshot({
    dailyCalorieTargetKcal: calorieTarget,
    weightKg: targetWeightKg,
  })

  const { data, error } = await supabase.rpc('save_body_metric_with_target_v1', {
    p_request_id: input.requestId,
    p_metric: input.metric,
    ...targetSnapshotRpcArgs(snapshot, targetEffectiveDate),
  })

  if (error) {
    console.error('body_metrics insert failed', { code: error.code })
    return { ok: false, status: 500, message: '保存失败，请稍后重试' }
  }
  const result = data as { body_metric_id: string; idempotent?: boolean }
  const cacheInvalidation = await invalidateDayDerivedCache(supabase, userId, input.metric.date)
  return {
    ok: true,
    id: result.body_metric_id,
    idempotent: Boolean(result.idempotent),
    affectedDates: [...new Set([input.metric.date, targetEffectiveDate])],
    cacheInvalidation,
  }
}

/** The stored row for one day, shaped as a write payload. null = nothing recorded that day. */
export async function loadBodyMetricForDate(
  supabase: SupabaseClient,
  userId: string,
  date: string,
): Promise<BodyMetricsInput | null> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select(`date,${bodyMetricNumberFields.join(',')},custom_metrics,notes`)
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as unknown as Record<string, unknown>
  const metric = { date, custom_metrics: null, notes: null } as unknown as BodyMetricsInput
  for (const field of bodyMetricNumberFields) {
    const value = row[field]
    metric[field] = value === null || value === undefined ? null : Number(value)
  }
  const custom = row.custom_metrics
  metric.custom_metrics = custom && typeof custom === 'object' && !Array.isArray(custom) && Object.keys(custom).length > 0
    ? (custom as Record<string, number>)
    : null
  metric.notes = typeof row.notes === 'string' && row.notes ? row.notes : null
  return metric
}

/**
 * A weight-only write must not erase what else was recorded that day.
 * save_body_metric_with_target_v1 replaces the WHOLE row on a same-day write
 * (every column is taken from the payload), so the existing waist, body fat,
 * custom metrics and note are carried over and only the weight changes.
 */
export function mergeWeightIntoExisting(existing: BodyMetricsInput | null, date: string, weightKg: number): BodyMetricsInput {
  if (!existing) {
    const empty = { date, custom_metrics: null, notes: null } as unknown as BodyMetricsInput
    for (const field of bodyMetricNumberFields) empty[field] = null
    empty.weight_kg = weightKg
    return empty
  }
  return { ...existing, date, weight_kg: weightKg }
}
