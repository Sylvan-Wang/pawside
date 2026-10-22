import type { Planner, PlannerResult } from '../../lib/coach-chat/planner'
import type { RawPlan } from '../../lib/coach-chat/schemas'
import type { EstimatePayload } from '../../lib/nutrition/food-resolver'
import type { FoodEstimator } from '../../lib/coach-chat/meal'

type RawTask = RawPlan['tasks'][number]
type RawItem = RawTask['items'][number]

/** A raw task as the model would return it, every field present. */
export function rawTask(kind: RawTask['kind'], fields: Partial<RawTask> = {}): RawTask {
  return {
    kind,
    draft_ref: null,
    date_ref: 'unspecified',
    explicit_date: null,
    meal_type: null,
    items: [],
    edits: [],
    workout_type: null,
    workout_minutes: null,
    workout_calories: null,
    workout_notes: null,
    weight_value: null,
    weight_unit: null,
    query_aspects: [],
    topic: null,
    boundary: null,
    source_quote: '',
    ...fields,
  }
}

export function rawItem(name: string, fields: Partial<RawItem> = {}): RawItem {
  return {
    name,
    amount_value: null,
    amount_unit: null,
    grams_estimate: null,
    estimate_basis: 'unknown',
    dish_kind: 'single',
    ...fields,
  }
}

export function rawPlan(tasks: RawTask[], extra: Partial<Omit<RawPlan, 'tasks'>> = {}): RawPlan {
  return { tasks, reply: null, clarification: null, ...extra }
}

/** Returns the given plans in order, one per call; throws if the code asks for more. */
export function scriptedPlanner(plans: Array<RawPlan | { fail: 'timeout' | 'upstream_error' | 'invalid_response' | 'not_configured' }>) {
  const calls: Array<{ system: string; input: string }> = []
  const planner: Planner = async (system, input) => {
    calls.push({ system, input })
    const next = plans[calls.length - 1]
    if (!next) throw new Error('planner called more times than scripted')
    if ('fail' in next) return { ok: false, reason: next.fail, model: 'scripted', latencyMs: 1 } satisfies PlannerResult
    return { ok: true, plan: next, model: 'scripted', latencyMs: 1 } satisfies PlannerResult
  }
  return { planner, calls }
}

export function fixedEstimator(table: Record<string, Partial<EstimatePayload>>) {
  const calls: string[][] = []
  const estimator: FoodEstimator = async (names) => {
    calls.push(names)
    const byName = new Map<string, EstimatePayload>()
    for (const name of names) {
      const row = table[name]
      if (row) {
        byName.set(name, {
          energy_kcal: 100, protein_g: 5, carb_g: 10, fat_g: 3, fiber_g: null,
          confidence: 0.5, caveat: '按常见做法估算', ...row,
        })
      }
    }
    return { ok: true, byName }
  }
  return { estimator, calls }
}

export const failingEstimator: FoodEstimator = async () => ({ ok: false, reason: 'timeout' })
