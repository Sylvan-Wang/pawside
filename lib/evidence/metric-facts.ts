import type { DailyNutritionFacts } from '../nutrition/persistence'
import { computeSessionFacts, type SessionFacts } from '../workout/session-facts'
import type { MetricFact } from '../nutrition/interpretation'
import { metricFact } from './interpret'

/**
 * Pawside — MetricFact builders (AI Patch §22).
 *
 * Every fact that the AI may repeat is produced here, so:
 *   - the AI has a closed set of numbers it is allowed to state (§31), and
 *   - a reviewer can see exactly which numbers are considered "trusted".
 *
 * `data_completeness` is always explicit; a fact is never emitted as `complete`
 * when part of its input was estimated (Product §5.2 / AC-P04).
 */

/** Nutrition budget facts: calories + all three macros, target and consumed. */
export function buildNutritionFacts(facts: DailyNutritionFacts): MetricFact[] {
  const completeness = facts.data_completeness
  const basis = {
    meal_count: facts.meal_count,
    target_source: facts.target.calories_kcal === null ? 'missing' : 'user_target',
    macro_source: facts.target.protein_g === null ? 'missing' : 'derived_macro',
  }

  // Each row carries the target metric key and its matching consumed key, so a
  // target can never be emitted without its counterpart.
  const rows: Array<{
    targetKey: string
    consumedKey: string
    target: number | null
    consumed: number | null
    unit: string
  }> = [
    { targetKey: 'nutrition.calories_target', consumedKey: 'nutrition.calories_consumed', target: facts.target.calories_kcal, consumed: facts.consumed.calories_kcal, unit: 'kcal' },
    { targetKey: 'nutrition.protein_target', consumedKey: 'nutrition.protein_consumed', target: facts.target.protein_g, consumed: facts.consumed.protein_g, unit: 'g' },
    { targetKey: 'nutrition.carbs_target', consumedKey: 'nutrition.carbs_consumed', target: facts.target.carbs_g, consumed: facts.consumed.carbs_g, unit: 'g' },
    { targetKey: 'nutrition.fat_target', consumedKey: 'nutrition.fat_consumed', target: facts.target.fat_g, consumed: facts.consumed.fat_g, unit: 'g' },
  ]

  const output: MetricFact[] = []

  for (const row of rows) {
    output.push(metricFact({
      metricKey: row.targetKey,
      // A missing target stays null — never a default (Product §27).
      value: row.target,
      unit: row.unit,
      window: 'day',
      calculationBasis: { ...basis, kind: 'target' },
      dataCompleteness: completeness,
    }))
    output.push(metricFact({
      metricKey: row.consumedKey,
      value: row.consumed,
      unit: row.unit,
      window: 'day',
      calculationBasis: { ...basis, kind: 'consumed' },
      dataCompleteness: completeness,
    }))
  }

  output.push(
    metricFact({
      metricKey: 'nutrition.meal_count',
      value: facts.meal_count,
      unit: null,
      window: 'day',
      calculationBasis: basis,
      dataCompleteness: completeness,
    }),
  )

  // Remaining is only emitted when a target exists, so the model can never
  // restate a remaining value derived from a missing target.
  if (facts.remaining) {
    const remainingRows: Array<[string, number | null, string]> = [
      ['nutrition.calories_remaining', facts.remaining.calories_kcal, 'kcal'],
      ['nutrition.protein_remaining', facts.remaining.protein_g, 'g'],
      ['nutrition.carbs_remaining', facts.remaining.carbs_g, 'g'],
      ['nutrition.fat_remaining', facts.remaining.fat_g, 'g'],
    ]
    for (const [key, value, unit] of remainingRows) {
      output.push(metricFact({
        metricKey: key,
        value,
        unit,
        window: 'day',
        calculationBasis: { ...basis, kind: 'remaining' },
        dataCompleteness: completeness,
      }))
    }
  }

  return output
}

/** Session-level workout facts (Product §13 Layer A). */
export function buildSessionFacts(session: SessionFacts): MetricFact[] {
  const completeness = session.record_completeness === 'full'
    ? 'complete'
    : session.record_completeness === 'none'
      ? 'unknown'
      : 'partial'

  const basis = {
    record_completeness: session.record_completeness,
    data_quality_flags: session.data_quality_flags,
  }

  const facts: MetricFact[] = [
    metricFact({
      metricKey: 'training.session_duration',
      value: session.duration_minutes,
      unit: 'min',
      window: 'session',
      calculationBasis: basis,
      dataCompleteness: completeness,
    }),
    metricFact({
      metricKey: 'training.exercise_count',
      value: session.exercise_count,
      unit: null,
      window: 'session',
      calculationBasis: basis,
      dataCompleteness: completeness,
    }),
    metricFact({
      metricKey: 'training.completed_exercise_count',
      value: session.completed_exercise_count,
      unit: null,
      window: 'session',
      calculationBasis: basis,
      dataCompleteness: completeness,
    }),
  ]

  // Recorded-as-null stays null: a session with no set detail must not present
  // "0 sets" as a fact (Guardrail §12).
  if (session.completed_set_count !== null) {
    facts.push(metricFact({
      metricKey: 'training.completed_set_count',
      value: session.completed_set_count,
      unit: null,
      window: 'session',
      calculationBasis: basis,
      dataCompleteness: completeness,
    }))
  }
  if (session.total_volume_kg !== null) {
    facts.push(metricFact({
      metricKey: 'training.total_volume_kg',
      value: session.total_volume_kg,
      unit: 'kg',
      window: 'session',
      calculationBasis: basis,
      dataCompleteness: completeness,
    }))
  }

  return facts
}

/** Convenience for callers that only have raw persisted rows. */
export function buildSessionFactsFromLog(input: {
  exercises: unknown
  durationMinutes: number | null
}): { session: SessionFacts; facts: MetricFact[] } {
  const session = computeSessionFacts(input)
  return { session, facts: buildSessionFacts(session) }
}
