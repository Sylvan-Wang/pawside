import { z } from 'zod'
import { findInternalTerms } from '../coach/display'
import type { DateRefKind, MealSlot } from './dates'

/**
 * The single contract between the model and the server (Patch §4).
 *
 * The model returns ONE structured plan per turn: what the user wants, as
 * slots. It does not execute anything, choose a user, compute nutrition, or
 * decide a calendar date. The server validates every field again here, then
 * runs a fixed set of tools. Anything the model gets wrong degrades into a
 * clarification or an `invalid` task - never into a write.
 */

export const PLAN_SCHEMA_NAME = 'pawside_coach_plan_v1'
export const PLAN_PROMPT_VERSION = 'coach_chat_plan_v2'

export const MAX_TASKS = 4
export const MAX_ITEMS_PER_MEAL = 12
export const MAX_EDITS = 8
export const MAX_NAME_CHARS = 40

export const TASK_KINDS = [
  'log_meal',
  'edit_meal',
  'log_workout',
  'log_weight',
  'query_day',
  'consult_food',
  'cancel_draft',
  'confirm_draft',
  'smalltalk',
  'out_of_scope',
] as const
export type TaskKind = (typeof TASK_KINDS)[number]

const DATE_REFS = ['unspecified', 'today', 'yesterday', 'day_before_yesterday', 'explicit'] as const
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
const ESTIMATE_BASES = ['user_stated', 'model_estimate', 'unknown'] as const
const DISH_KINDS = ['single', 'mixed_dish', 'drink', 'packaged'] as const
const EDIT_ACTIONS = ['scale_all', 'scale_item', 'remove_item', 'set_grams', 'replace_food'] as const
const WEIGHT_UNITS = ['kg', 'lb', 'jin'] as const
const QUERY_ASPECTS = ['meals', 'workouts', 'weight', 'nutrition'] as const
const BOUNDARIES = ['medical', 'finance', 'other'] as const
/** What a model-asked question is about; decides which kind of pending draft holds it. */
export const CLARIFY_ABOUT = ['meal', 'workout', 'weight', 'meal_edit'] as const
export type ClarifyAbout = (typeof CLARIFY_ABOUT)[number]

// ---------------------------------------------------------------------------
// Raw shape (what the model is asked to produce)
// ---------------------------------------------------------------------------

const rawItem = z.object({
  name: z.string(),
  amount_value: z.number().nullable(),
  amount_unit: z.string().nullable(),
  grams_estimate: z.number().nullable(),
  estimate_basis: z.enum(ESTIMATE_BASES),
  dish_kind: z.enum(DISH_KINDS),
})

const rawEdit = z.object({
  action: z.enum(EDIT_ACTIONS),
  target_item: z.string().nullable(),
  factor: z.number().nullable(),
  grams: z.number().nullable(),
  new_name: z.string().nullable(),
})

const rawTask = z.object({
  kind: z.enum(TASK_KINDS),
  draft_ref: z.string().nullable(),
  date_ref: z.enum(DATE_REFS),
  explicit_date: z.string().nullable(),
  meal_type: z.enum(MEAL_TYPES).nullable(),
  items: z.array(rawItem).max(MAX_ITEMS_PER_MEAL),
  edits: z.array(rawEdit).max(MAX_EDITS),
  workout_type: z.string().nullable(),
  workout_minutes: z.number().nullable(),
  workout_calories: z.number().nullable(),
  workout_notes: z.string().nullable(),
  weight_value: z.number().nullable(),
  weight_unit: z.enum(WEIGHT_UNITS).nullable(),
  query_aspects: z.array(z.enum(QUERY_ASPECTS)).max(4),
  topic: z.string().nullable(),
  boundary: z.enum(BOUNDARIES).nullable(),
  source_quote: z.string(),
})

export const rawPlanSchema = z.object({
  tasks: z.array(rawTask).max(MAX_TASKS),
  reply: z.string().nullable(),
  clarification: z.object({
    about: z.enum(CLARIFY_ABOUT),
    question: z.string(),
    options: z.array(z.string()).max(4),
  }).nullable(),
})
export type RawPlan = z.infer<typeof rawPlanSchema>

/** Type guard shaped for callStructuredOutput's `validate` argument. */
export function isRawPlan(value: unknown): value is RawPlan {
  return rawPlanSchema.safeParse(value).success
}

// ---------------------------------------------------------------------------
// JSON Schema for OpenAI strict structured output.
// Strict mode needs every property listed in `required` and no extras, so
// "optional" is expressed as nullable. tests/coach-chat/schemas.test.ts keeps
// this in lock-step with the zod shape above.
// ---------------------------------------------------------------------------

const nullable = (type: string) => ({ type: [type, 'null'] })
const nullableEnum = (values: readonly string[]) => ({ type: ['string', 'null'], enum: [...values, null] })

export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      maxItems: MAX_TASKS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: [...TASK_KINDS] },
          draft_ref: nullable('string'),
          date_ref: { type: 'string', enum: [...DATE_REFS] },
          explicit_date: nullable('string'),
          meal_type: nullableEnum(MEAL_TYPES),
          items: {
            type: 'array',
            maxItems: MAX_ITEMS_PER_MEAL,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', maxLength: 60 },
                amount_value: nullable('number'),
                amount_unit: nullable('string'),
                grams_estimate: nullable('number'),
                estimate_basis: { type: 'string', enum: [...ESTIMATE_BASES] },
                dish_kind: { type: 'string', enum: [...DISH_KINDS] },
              },
              required: ['name', 'amount_value', 'amount_unit', 'grams_estimate', 'estimate_basis', 'dish_kind'],
            },
          },
          edits: {
            type: 'array',
            maxItems: MAX_EDITS,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                action: { type: 'string', enum: [...EDIT_ACTIONS] },
                target_item: nullable('string'),
                factor: nullable('number'),
                grams: nullable('number'),
                new_name: nullable('string'),
              },
              required: ['action', 'target_item', 'factor', 'grams', 'new_name'],
            },
          },
          workout_type: nullable('string'),
          workout_minutes: nullable('number'),
          workout_calories: nullable('number'),
          workout_notes: nullable('string'),
          weight_value: nullable('number'),
          weight_unit: nullableEnum(WEIGHT_UNITS),
          query_aspects: { type: 'array', maxItems: 4, items: { type: 'string', enum: [...QUERY_ASPECTS] } },
          topic: nullable('string'),
          boundary: nullableEnum(BOUNDARIES),
          source_quote: { type: 'string', maxLength: 80 },
        },
        required: [
          'kind', 'draft_ref', 'date_ref', 'explicit_date', 'meal_type', 'items', 'edits',
          'workout_type', 'workout_minutes', 'workout_calories', 'workout_notes',
          'weight_value', 'weight_unit', 'query_aspects', 'topic', 'boundary', 'source_quote',
        ],
      },
    },
    reply: { type: ['string', 'null'], maxLength: 160 },
    clarification: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            about: { type: 'string', enum: [...CLARIFY_ABOUT] },
            question: { type: 'string', maxLength: 80 },
            options: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 24 } },
          },
          required: ['about', 'question', 'options'],
        },
      ],
    },
  },
  required: ['tasks', 'reply', 'clarification'],
} as const

// ---------------------------------------------------------------------------
// Normalised plan (what the rest of the server is allowed to see)
// ---------------------------------------------------------------------------

export type EstimateBasis = (typeof ESTIMATE_BASES)[number]
export type DishKind = (typeof DISH_KINDS)[number]
export type EditAction = (typeof EDIT_ACTIONS)[number]
export type WeightUnit = (typeof WEIGHT_UNITS)[number]
export type QueryAspect = (typeof QUERY_ASPECTS)[number]
export type Boundary = (typeof BOUNDARIES)[number]

export interface PlanItem {
  name: string
  amountValue: number | null
  amountUnit: string | null
  /** Server-derived when the user gave grams/kg/斤/两/ml; else the model's estimate or null. */
  grams: number | null
  gramsBasis: 'user_grams' | 'unit_conversion' | 'volume_assumed' | 'model_estimate' | 'unknown'
  dishKind: DishKind
}

export interface PlanEdit {
  action: EditAction
  targetItem: string | null
  factor: number | null
  grams: number | null
  newName: string | null
}

interface DateSlots {
  dateRef: DateRefKind
  explicitDate: string | null
}

export type PlanTask =
  | ({ kind: 'log_meal'; draftRef: string | null; mealType: MealSlot | null; items: PlanItem[] } & DateSlots)
  | ({ kind: 'edit_meal'; draftRef: string | null; mealType: MealSlot | null; items: PlanItem[]; edits: PlanEdit[] } & DateSlots)
  | ({ kind: 'log_workout'; workoutType: string; minutes: number; calories: number | null; notes: string | null } & DateSlots)
  | ({ kind: 'log_weight'; value: number; unit: WeightUnit | null } & DateSlots)
  | ({ kind: 'query_day'; aspects: QueryAspect[] } & DateSlots)
  | { kind: 'consult_food'; topic: string | null }
  | { kind: 'cancel_draft'; draftRef: string | null }
  | { kind: 'confirm_draft'; draftRef: string | null }
  | { kind: 'smalltalk' }
  | { kind: 'out_of_scope'; boundary: Boundary }
  | { kind: 'invalid'; intended: TaskKind; reason: string }

export interface NormalizedPlan {
  tasks: PlanTask[]
  /** Model text, only when it passed the no-numbers / no-internal-terms checks. */
  reply: string | null
  clarification: { about: ClarifyAbout; question: string; options: string[] } | null
  issues: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Trim, collapse whitespace, drop control characters. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.slice(0, max)
}

const GRAM_UNITS = new Set(['g', '克', '公克'])
const KG_UNITS = new Set(['kg', '千克', '公斤'])
const JIN_UNITS = new Set(['斤'])
const LIANG_UNITS = new Set(['两'])
const ML_UNITS = new Set(['ml', '毫升'])
const LITRE_UNITS = new Set(['l', '升'])

function finitePositive(value: number | null, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : null
}

/**
 * Grams for one item. A weight the USER stated (in a unit we can convert
 * exactly) beats whatever the model estimated, so a model cannot silently
 * change "200克" into something else.
 */
export function deriveGrams(
  amountValue: number | null,
  amountUnit: string | null,
  modelEstimate: number | null,
  basis: EstimateBasis,
): { grams: number | null; basis: PlanItem['gramsBasis'] } {
  const unit = amountUnit?.trim().toLowerCase() ?? null
  if (amountValue !== null && unit) {
    if (GRAM_UNITS.has(unit)) return { grams: amountValue, basis: 'user_grams' }
    if (KG_UNITS.has(unit)) return { grams: amountValue * 1000, basis: 'unit_conversion' }
    if (JIN_UNITS.has(unit)) return { grams: amountValue * 500, basis: 'unit_conversion' }
    if (LIANG_UNITS.has(unit)) return { grams: amountValue * 50, basis: 'unit_conversion' }
    if (ML_UNITS.has(unit)) return { grams: amountValue, basis: 'volume_assumed' }
    if (LITRE_UNITS.has(unit)) return { grams: amountValue * 1000, basis: 'volume_assumed' }
  }
  if (modelEstimate !== null) {
    return { grams: modelEstimate, basis: basis === 'unknown' ? 'unknown' : 'model_estimate' }
  }
  return { grams: null, basis: 'unknown' }
}

function normalizeItem(item: z.infer<typeof rawItem>): PlanItem | null {
  const name = cleanText(item.name, MAX_NAME_CHARS)
  if (!name) return null
  const amountValue = finitePositive(item.amount_value, 1_000_000)
  const amountUnit = cleanText(item.amount_unit, 8)
  const estimate = finitePositive(item.grams_estimate, 3000)
  const derived = deriveGrams(amountValue, amountUnit, estimate, item.estimate_basis)
  // A derived weight must still be believable; otherwise treat the weight as unknown.
  const grams = derived.grams !== null && derived.grams > 0 && derived.grams <= 5000 ? derived.grams : null
  return {
    name,
    amountValue,
    amountUnit,
    grams,
    gramsBasis: grams === null ? 'unknown' : derived.basis,
    dishKind: item.dish_kind,
  }
}

function normalizeEdit(edit: z.infer<typeof rawEdit>): PlanEdit | null {
  const targetItem = cleanText(edit.target_item, MAX_NAME_CHARS)
  const factor = typeof edit.factor === 'number' && Number.isFinite(edit.factor) && edit.factor > 0 && edit.factor <= 5
    ? edit.factor
    : null
  const grams = finitePositive(edit.grams, 5000)
  const newName = cleanText(edit.new_name, MAX_NAME_CHARS)

  switch (edit.action) {
    case 'scale_all':
      return factor === null ? null : { action: 'scale_all', targetItem: null, factor, grams: null, newName: null }
    case 'scale_item':
      return factor === null || !targetItem ? null : { action: 'scale_item', targetItem, factor, grams: null, newName: null }
    case 'remove_item':
      return targetItem ? { action: 'remove_item', targetItem, factor: null, grams: null, newName: null } : null
    case 'set_grams':
      return grams === null || !targetItem ? null : { action: 'set_grams', targetItem, factor: null, grams, newName: null }
    case 'replace_food':
      return !targetItem || !newName ? null : { action: 'replace_food', targetItem, factor: null, grams: null, newName }
  }
}

const WORKOUT_TYPE_ALIASES: Array<[RegExp, string]> = [
  [/跑|慢跑|跑步|有氧|椭圆|骑|单车|游泳|跳绳|快走|健走|爬楼|划船/, '有氧'],
  [/胸|卧推/, '胸'],
  [/背|引体|划船|下拉/, '背'],
  [/腿|深蹲|臀|硬拉/, '腿'],
  [/肩|推举/, '肩'],
  [/手臂|二头|三头|弯举/, '手臂'],
  [/拉伸|瑜伽|普拉提|放松/, '拉伸'],
]

/**
 * Maps the user's activity word to the app's workout type list. The original
 * wording is kept in `notes` by the caller, so "游泳" is not lost when it is
 * filed under 有氧; anything unrecognised is 其他.
 */
export function workoutTypeFor(activity: string): string {
  for (const [pattern, type] of WORKOUT_TYPE_ALIASES) {
    if (pattern.test(activity)) return type
  }
  return '其他'
}

function normalizeTask(task: z.infer<typeof rawTask>, issues: string[]): PlanTask | null {
  const dateSlots: DateSlots = { dateRef: task.date_ref, explicitDate: cleanText(task.explicit_date, 10) }
  const draftRef = task.draft_ref && UUID.test(task.draft_ref.trim()) ? task.draft_ref.trim().toLowerCase() : null

  switch (task.kind) {
    case 'log_meal':
    case 'edit_meal': {
      const items = task.items.map(normalizeItem).filter((item): item is PlanItem => item !== null)
      if (items.length < task.items.length) issues.push('dropped_invalid_items')
      if (task.kind === 'log_meal') {
        if (items.length === 0) return { kind: 'invalid', intended: 'log_meal', reason: 'no_food_items' }
        return { kind: 'log_meal', draftRef, mealType: task.meal_type, items, ...dateSlots }
      }
      const edits = task.edits.map(normalizeEdit).filter((edit): edit is PlanEdit => edit !== null)
      if (edits.length < task.edits.length) issues.push('dropped_invalid_edits')
      if (edits.length === 0 && items.length === 0) {
        return { kind: 'invalid', intended: 'edit_meal', reason: 'no_usable_edit' }
      }
      return { kind: 'edit_meal', draftRef, mealType: task.meal_type, items, edits, ...dateSlots }
    }
    case 'log_workout': {
      const activity = cleanText(task.workout_type, 30)
      const minutes = typeof task.workout_minutes === 'number' && Number.isFinite(task.workout_minutes)
        ? Math.round(task.workout_minutes)
        : null
      if (!activity) return { kind: 'invalid', intended: 'log_workout', reason: 'no_activity' }
      if (minutes === null || minutes < 1 || minutes > 1440) {
        return { kind: 'invalid', intended: 'log_workout', reason: 'bad_duration' }
      }
      const calories = typeof task.workout_calories === 'number'
        && Number.isFinite(task.workout_calories)
        && task.workout_calories >= 0
        && task.workout_calories <= 20_000
        ? Math.round(task.workout_calories)
        : null
      const note = cleanText(task.workout_notes, 200)
      return {
        kind: 'log_workout',
        workoutType: workoutTypeFor(activity),
        minutes,
        calories,
        // Keep what the user actually called it, e.g. 游泳, when it was filed under a broader type.
        notes: workoutTypeFor(activity) !== activity ? [activity, note].filter(Boolean).join('；') : note,
        ...dateSlots,
      }
    }
    case 'log_weight': {
      const value = finitePositive(task.weight_value, 1000)
      if (value === null) return { kind: 'invalid', intended: 'log_weight', reason: 'bad_weight' }
      return { kind: 'log_weight', value, unit: task.weight_unit, ...dateSlots }
    }
    case 'query_day': {
      const aspects = [...new Set(task.query_aspects)]
      return { kind: 'query_day', aspects: aspects.length > 0 ? aspects : ['meals', 'workouts', 'weight', 'nutrition'], ...dateSlots }
    }
    case 'consult_food':
      return { kind: 'consult_food', topic: cleanText(task.topic, 40) }
    case 'cancel_draft':
      return { kind: 'cancel_draft', draftRef }
    case 'confirm_draft':
      return { kind: 'confirm_draft', draftRef }
    case 'smalltalk':
      return { kind: 'smalltalk' }
    case 'out_of_scope':
      return { kind: 'out_of_scope', boundary: task.boundary ?? 'other' }
  }
}

/** Model free text is allowed only if it cannot introduce a number or leak internals. */
export function acceptableModelText(value: string | null | undefined, max = 160): string | null {
  const text = cleanText(value, max)
  if (!text) return null
  if (/\d/.test(text)) return null
  if (findInternalTerms([text]).length > 0) return null
  return text
}

export function normalizePlan(raw: RawPlan): NormalizedPlan {
  const issues: string[] = []
  const tasks = raw.tasks
    .slice(0, MAX_TASKS)
    .map((task) => normalizeTask(task, issues))
    .filter((task): task is PlanTask => task !== null)

  const replyText = acceptableModelText(raw.reply)
  if (raw.reply && !replyText) issues.push('dropped_model_reply')

  let clarification: NormalizedPlan['clarification'] = null
  if (raw.clarification) {
    const question = acceptableModelText(raw.clarification.question, 80)
    const options = raw.clarification.options
      .map((option) => cleanText(option, 24))
      .filter((option): option is string => option !== null)
      .slice(0, 4)
    if (question) clarification = { about: raw.clarification.about, question, options }
    else issues.push('dropped_clarification')
  }

  return { tasks, reply: replyText, clarification, issues }
}
