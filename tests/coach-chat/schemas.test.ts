import { describe, expect, it } from 'vitest'
import {
  acceptableModelText,
  deriveGrams,
  isRawPlan,
  normalizePlan,
  PLAN_JSON_SCHEMA,
  rawPlanSchema,
  workoutTypeFor,
} from '../../lib/coach-chat/schemas'
import { rawItem, rawPlan, rawTask } from './helpers'

type JsonSchema = { type?: unknown; properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean; items?: JsonSchema; anyOf?: JsonSchema[] }

function walkObjects(schema: JsonSchema, visit: (object: JsonSchema, path: string) => void, path = '$') {
  if (schema.properties) {
    visit(schema, path)
    for (const [key, child] of Object.entries(schema.properties)) walkObjects(child, visit, `${path}.${key}`)
  }
  if (schema.items) walkObjects(schema.items, visit, `${path}[]`)
  schema.anyOf?.forEach((branch, index) => walkObjects(branch, visit, `${path}|${index}`))
}

describe('plan JSON schema (OpenAI strict mode rules)', () => {
  it('lists every property as required and forbids extras, at every level', () => {
    const problems: string[] = []
    walkObjects(PLAN_JSON_SCHEMA as unknown as JsonSchema, (object, path) => {
      const keys = Object.keys(object.properties ?? {}).sort()
      const required = [...(object.required ?? [])].sort()
      if (JSON.stringify(keys) !== JSON.stringify(required)) problems.push(`${path}: required != properties`)
      if (object.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`)
    })
    expect(problems).toEqual([])
  })

  it('matches the zod shape the server validates with', () => {
    const schemaTask = (PLAN_JSON_SCHEMA as unknown as JsonSchema).properties!.tasks.items!
    const zodTask = (rawPlanSchema.shape.tasks.element as unknown as { shape: Record<string, unknown> }).shape
    expect(Object.keys(schemaTask.properties!).sort()).toEqual(Object.keys(zodTask).sort())
    const schemaItem = schemaTask.properties!.items.items!
    const zodItem = (rawPlanSchema.shape.tasks.element.shape.items.element as unknown as { shape: Record<string, unknown> }).shape
    expect(Object.keys(schemaItem.properties!).sort()).toEqual(Object.keys(zodItem).sort())
    const schemaEdit = schemaTask.properties!.edits.items!
    const zodEdit = (rawPlanSchema.shape.tasks.element.shape.edits.element as unknown as { shape: Record<string, unknown> }).shape
    expect(Object.keys(schemaEdit.properties!).sort()).toEqual(Object.keys(zodEdit).sort())
  })

  it('accepts a well-formed plan and rejects malformed ones', () => {
    expect(isRawPlan(rawPlan([rawTask('smalltalk')]))).toBe(true)
    expect(isRawPlan({ tasks: [], reply: null })).toBe(false) // clarification missing
    expect(isRawPlan(rawPlan([{ ...rawTask('smalltalk'), kind: 'drop_database' as never }]))).toBe(false)
    expect(isRawPlan(rawPlan(Array.from({ length: 5 }, () => rawTask('smalltalk'))))).toBe(false)
  })
})

describe('weights the user stated beat the model', () => {
  it('converts exact units itself', () => {
    expect(deriveGrams(200, '克', 999, 'model_estimate')).toEqual({ grams: 200, basis: 'user_grams' })
    expect(deriveGrams(200, 'g', null, 'user_stated')).toEqual({ grams: 200, basis: 'user_grams' })
    expect(deriveGrams(1.5, 'kg', null, 'user_stated')).toEqual({ grams: 1500, basis: 'unit_conversion' })
    expect(deriveGrams(2, '斤', null, 'user_stated')).toEqual({ grams: 1000, basis: 'unit_conversion' })
    expect(deriveGrams(3, '两', null, 'user_stated')).toEqual({ grams: 150, basis: 'unit_conversion' })
    expect(deriveGrams(250, 'ml', null, 'user_stated')).toEqual({ grams: 250, basis: 'volume_assumed' })
    expect(deriveGrams(1, 'L', null, 'user_stated')).toEqual({ grams: 1000, basis: 'volume_assumed' })
  })

  it('falls back to the model estimate only for non-weight units, and says so', () => {
    expect(deriveGrams(1, '碗', 200, 'model_estimate')).toEqual({ grams: 200, basis: 'model_estimate' })
    expect(deriveGrams(1, '碗', null, 'unknown')).toEqual({ grams: null, basis: 'unknown' })
    expect(deriveGrams(null, null, 150, 'unknown')).toEqual({ grams: 150, basis: 'unknown' })
  })
})

describe('normalizePlan', () => {
  it('turns a meal into clean items and server-derived grams', () => {
    const plan = normalizePlan(rawPlan([rawTask('log_meal', {
      meal_type: 'lunch',
      items: [
        rawItem('  米饭 ', { amount_value: 200, amount_unit: '克', grams_estimate: 5, estimate_basis: 'user_stated' }),
        rawItem('宫保鸡丁', { amount_value: 1, amount_unit: '份', grams_estimate: 250, estimate_basis: 'model_estimate', dish_kind: 'mixed_dish' }),
        rawItem('   '),
      ],
    })]))
    const task = plan.tasks[0]
    expect(task.kind).toBe('log_meal')
    if (task.kind !== 'log_meal') return
    expect(task.items).toHaveLength(2)
    expect(task.items[0]).toMatchObject({ name: '米饭', grams: 200, gramsBasis: 'user_grams' })
    expect(task.items[1]).toMatchObject({ name: '宫保鸡丁', grams: 250, gramsBasis: 'model_estimate', dishKind: 'mixed_dish' })
    expect(plan.issues).toContain('dropped_invalid_items')
  })

  it('drops absurd weights instead of trusting them', () => {
    const plan = normalizePlan(rawPlan([rawTask('log_meal', {
      items: [
        rawItem('米饭', { amount_value: 99999, amount_unit: '克' }),
        rawItem('面', { grams_estimate: 50000, estimate_basis: 'model_estimate' }),
      ],
    })]))
    const task = plan.tasks[0]
    if (task.kind !== 'log_meal') throw new Error('expected log_meal')
    expect(task.items[0].grams).toBeNull()
    expect(task.items[1].grams).toBeNull()
  })

  it('treats a meal with no usable food as invalid, not as an empty record', () => {
    const plan = normalizePlan(rawPlan([rawTask('log_meal', { items: [] })]))
    expect(plan.tasks).toEqual([{ kind: 'invalid', intended: 'log_meal', reason: 'no_food_items' }])
  })

  it('validates workouts: duration is required and bounded; type is filed under the app list', () => {
    const ok = normalizePlan(rawPlan([rawTask('log_workout', { workout_type: '游泳', workout_minutes: 30.4, workout_calories: 250.6 })])).tasks[0]
    expect(ok).toMatchObject({ kind: 'log_workout', workoutType: '有氧', minutes: 30, calories: 251, notes: '游泳' })

    const keep = normalizePlan(rawPlan([rawTask('log_workout', { workout_type: '胸', workout_minutes: 45 })])).tasks[0]
    expect(keep).toMatchObject({ kind: 'log_workout', workoutType: '胸', notes: null, calories: null })

    for (const minutes of [null, 0, -5, 1441]) {
      expect(normalizePlan(rawPlan([rawTask('log_workout', { workout_type: '跑步', workout_minutes: minutes })])).tasks[0])
        .toMatchObject({ kind: 'invalid', reason: 'bad_duration' })
    }
    expect(normalizePlan(rawPlan([rawTask('log_workout', { workout_minutes: 30 })])).tasks[0]).toMatchObject({ kind: 'invalid', reason: 'no_activity' })
    // calories out of range are ignored, not stored
    const calories = normalizePlan(rawPlan([rawTask('log_workout', { workout_type: '跑步', workout_minutes: 20, workout_calories: 99999 })])).tasks[0]
    expect(calories).toMatchObject({ kind: 'log_workout', calories: null })
  })

  it('maps activity words to workout types', () => {
    expect(workoutTypeFor('跑步')).toBe('有氧')
    expect(workoutTypeFor('卧推')).toBe('胸')
    expect(workoutTypeFor('深蹲')).toBe('腿')
    expect(workoutTypeFor('瑜伽')).toBe('拉伸')
    expect(workoutTypeFor('攀岩')).toBe('其他')
  })

  it('validates weight and edit operations', () => {
    expect(normalizePlan(rawPlan([rawTask('log_weight', { weight_value: 72.5, weight_unit: 'kg' })])).tasks[0])
      .toMatchObject({ kind: 'log_weight', value: 72.5, unit: 'kg' })
    expect(normalizePlan(rawPlan([rawTask('log_weight', { weight_value: -3 })])).tasks[0]).toMatchObject({ kind: 'invalid', reason: 'bad_weight' })
    expect(normalizePlan(rawPlan([rawTask('log_weight', { weight_value: null })])).tasks[0]).toMatchObject({ kind: 'invalid', reason: 'bad_weight' })

    const edits = normalizePlan(rawPlan([rawTask('edit_meal', {
      edits: [
        { action: 'scale_all', target_item: null, factor: 0.5, grams: null, new_name: null },
        { action: 'scale_all', target_item: null, factor: 0, grams: null, new_name: null },
        { action: 'scale_item', target_item: null, factor: 0.5, grams: null, new_name: null },
        { action: 'replace_food', target_item: '鸡肉', factor: null, grams: null, new_name: '鱼' },
        { action: 'set_grams', target_item: '米饭', factor: null, grams: -1, new_name: null },
      ],
    })])).tasks[0]
    expect(edits.kind).toBe('edit_meal')
    if (edits.kind === 'edit_meal') {
      expect(edits.edits.map((e) => e.action)).toEqual(['scale_all', 'replace_food'])
    }
    expect(normalizePlan(rawPlan([rawTask('edit_meal')])).tasks[0]).toMatchObject({ kind: 'invalid', reason: 'no_usable_edit' })
  })

  it('keeps only well-formed draft references', () => {
    const good = '3f2b8c1e-0a4d-4f5e-9a7b-1c2d3e4f5a6b'
    const task = (ref: string | null) => normalizePlan(rawPlan([rawTask('cancel_draft', { draft_ref: ref })])).tasks[0]
    expect(task(good)).toEqual({ kind: 'cancel_draft', draftRef: good })
    expect(task('D1')).toEqual({ kind: 'cancel_draft', draftRef: null })
    expect(task("'; drop table coach_drafts; --")).toEqual({ kind: 'cancel_draft', draftRef: null })
  })

  it('never lets model text carry numbers, internal terms or control characters', () => {
    expect(acceptableModelText('奶茶可以喝，选小杯少糖。')).toBe('奶茶可以喝，选小杯少糖。')
    expect(acceptableModelText('一杯大约 300 千卡')).toBeNull()
    expect(acceptableModelText('已保存，共2项')).toBeNull()
    expect(acceptableModelText('状态是 within_reference')).toBeNull()
    expect(acceptableModelText('  ')).toBeNull()
    expect(acceptableModelText('你好\n\u0007世界')).toBe('你好 世界')

    const plan = normalizePlan(rawPlan([rawTask('smalltalk')], {
      reply: '热量大约 200 千卡',
      clarification: { about: 'meal', question: '吃了 3 样？', options: ['a', 'b', 'c', 'd'] },
    }))
    expect(plan.reply).toBeNull()
    expect(plan.clarification).toBeNull()
    expect(plan.issues).toEqual(expect.arrayContaining(['dropped_model_reply', 'dropped_clarification']))
  })

  it('keeps a clean clarification', () => {
    const plan = normalizePlan(rawPlan([], { clarification: { about: 'workout', question: '大概做了多久？', options: ['半小时', '一小时'] } }))
    expect(plan.clarification).toEqual({ about: 'workout', question: '大概做了多久？', options: ['半小时', '一小时'] })
  })
})
