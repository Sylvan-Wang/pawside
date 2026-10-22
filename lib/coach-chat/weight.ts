import type { SupabaseClient } from '@supabase/supabase-js'
import { loadBodyMetricForDate, mergeWeightIntoExisting, saveBodyMetric } from '../body-metrics-service'
import type { DateSource } from './dates'
import type { WeightUnit } from './schemas'
import type { DraftRow, WeightDraftPayload } from './types'

const KG_PER_LB = 0.45359237
export const MIN_WEIGHT_KG = 20
export const MAX_WEIGHT_KG = 400

export function toKg(value: number, unit: WeightUnit): number {
  if (unit === 'lb') return value * KG_PER_LB
  if (unit === 'jin') return value * 0.5
  return value
}

export type WeightBuild =
  | { ok: true; payload: WeightDraftPayload }
  | { ok: false; reason: 'out_of_range' }

/**
 * A weight card. When the user gave no unit, their saved preference (kg or lb)
 * is used AND shown on the card, so a wrong guess is visible before it is saved.
 */
export async function buildWeightPayload(input: {
  supabase: SupabaseClient
  userId: string
  value: number
  unit: WeightUnit | null
  profileUnit: 'kg' | 'lb'
  date: string
  dateSource: DateSource
  rawText: string
}): Promise<WeightBuild> {
  const unit = input.unit ?? input.profileUnit
  const kg = toKg(input.value, unit)
  if (!(kg >= MIN_WEIGHT_KG && kg <= MAX_WEIGHT_KG)) return { ok: false, reason: 'out_of_range' }

  const existing = await loadBodyMetricForDate(input.supabase, input.userId, input.date)
  return {
    ok: true,
    payload: {
      v: 1,
      date: input.date,
      date_source: input.dateSource,
      weight_kg: Math.round(kg * 1000) / 1000,
      shown_value: input.value,
      shown_unit: unit,
      unit_source: input.unit ? 'user' : 'profile',
      replaces_kg: existing?.weight_kg ?? null,
      raw_text: input.rawText.slice(0, 500),
    },
  }
}

export async function commitWeight(
  supabase: SupabaseClient,
  userId: string,
  draft: DraftRow,
  timeZone: string,
): Promise<{ bodyMetricId: string; idempotent: boolean; date: string }> {
  const payload = draft.payload as WeightDraftPayload
  // Re-read at commit time: the day's other measurements may have changed since the card was shown.
  const existing = await loadBodyMetricForDate(supabase, userId, payload.date)
  const metric = mergeWeightIntoExisting(existing, payload.date, payload.weight_kg)
  const result = await saveBodyMetric(supabase, userId, {
    requestId: draft.request_id,
    timeZone,
    metric,
  })
  if (!result.ok) {
    const failure = new Error(result.message) as Error & { code?: string }
    failure.code = String(result.status)
    throw failure
  }
  return { bodyMetricId: result.id, idempotent: result.idempotent, date: payload.date }
}
