import type { ParsedQuantities, QuantityRange } from './parse-quantities'

export interface ExerciseDefaultRow {
  sets_min: number | null; sets_max: number | null
  reps_min: number | null; reps_max: number | null
  rest_seconds_min: number | null; rest_seconds_max: number | null
  duration_seconds: number | null; distance_m: number | null
  failure_policy: 'avoid' | 'allowed' | 'required'
  review_status: 'draft' | 'reviewed'
}

export type FilledValue<T> = { value: T | null; authority: 'method_explicit' | 'library_default' | 'ai_inferred'; quote: string | null }

function supplied<T>(value: T | null, fallback: T | null, reviewed: boolean, quote: string | null): FilledValue<T> {
  if (value != null) return { value, authority: 'method_explicit', quote }
  return { value: fallback, authority: reviewed ? 'library_default' : 'ai_inferred', quote: null }
}

export function fillExerciseDefaults(parsed: ParsedQuantities, row: ExerciseDefaultRow | null, quote: string) {
  const reviewed = row?.review_status === 'reviewed'
  const setsFallback: QuantityRange | null = row?.sets_min != null
    ? { min: row.sets_min, max: row.sets_max ?? row.sets_min }
    : null
  const repsFallback: QuantityRange | null = row?.reps_min != null
    ? { min: row.reps_min, max: row.reps_max ?? row.reps_min }
    : null
  const restFallback: QuantityRange | null = row?.rest_seconds_min != null
    ? { min: row.rest_seconds_min, max: row.rest_seconds_max ?? row.rest_seconds_min }
    : null
  return {
    sets: supplied(parsed.sets, setsFallback, reviewed, parsed.sets ? quote : null),
    reps: supplied(parsed.reps, repsFallback, reviewed, parsed.reps ? quote : null),
    restSeconds: supplied(parsed.restSeconds, restFallback, reviewed, parsed.restSeconds ? quote : null),
    durationSeconds: supplied(parsed.duration?.min ?? null, row?.duration_seconds ?? null, reviewed, parsed.duration ? quote : null),
    distanceM: supplied(parsed.distanceM?.min ?? null, row?.distance_m ?? null, reviewed, parsed.distanceM ? quote : null),
    failure: parsed.failure === 'required_or_allowed' ? 'allowed' : parsed.failure ?? row?.failure_policy ?? 'avoid',
  }
}
