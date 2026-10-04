import { z } from 'zod'

const quoteItem = z.object({ text: z.string(), quote: z.string() })
export const OutlineExtractionSchema = z.object({
  looks_like_training_plan: z.boolean(),
  reason: z.string(),
  method_name: z.string().nullable(),
  level_hint: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
  variants: z.array(z.object({ label: z.string(), section_quote: z.string() })),
  days: z.array(z.object({
    name_zh: z.string(),
    day_type: z.enum(['strength', 'core', 'cardio']),
    variant_label: z.string().nullable(),
    section_quote: z.string(),
  })),
  open_questions: z.array(z.object({ question: z.string(), quote: z.string().nullable() })),
})

export const DayExtractionSchema = z.object({
  exercises: z.array(z.object({
    name: z.string(), quote: z.string(),
    role_hint: z.enum(['primary', 'secondary', 'accessory', 'isolation']).nullable(),
    sets_phrase: z.string().nullable(), reps_phrase: z.string().nullable(),
    rest_phrase: z.string().nullable(), rest_between_exercises_phrase: z.string().nullable(),
    duration_phrase: z.string().nullable(), distance_phrase: z.string().nullable(),
    failure_phrase: z.string().nullable(), per_side_phrase: z.string().nullable(),
    equipment_hint: z.string().nullable(), variant_label: z.string().nullable(),
    alternatives: z.array(z.object({ name: z.string(), quote: z.string() })),
    cues: z.array(quoteItem),
  })),
  warmup_notes: z.array(quoteItem),
  cooldown_notes: z.array(quoteItem),
})

export type OutlineExtraction = z.infer<typeof OutlineExtractionSchema>
export type DayExtraction = z.infer<typeof DayExtractionSchema>

function strictSchema(schema: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, ...schema }
}

export const outlineExtractionJsonSchema = strictSchema({
  properties: {
    looks_like_training_plan: { type: 'boolean' }, reason: { type: 'string' },
    method_name: { type: ['string', 'null'] },
    level_hint: { type: ['string', 'null'], enum: ['beginner', 'intermediate', 'advanced', null] },
    variants: { type: 'array', items: strictSchema({ properties: { label: { type: 'string' }, section_quote: { type: 'string' } }, required: ['label', 'section_quote'] }) },
    days: { type: 'array', items: strictSchema({ properties: { name_zh: { type: 'string' }, day_type: { type: 'string', enum: ['strength', 'core', 'cardio'] }, variant_label: { type: ['string', 'null'] }, section_quote: { type: 'string' } }, required: ['name_zh', 'day_type', 'variant_label', 'section_quote'] }) },
    open_questions: { type: 'array', items: strictSchema({ properties: { question: { type: 'string' }, quote: { type: ['string', 'null'] } }, required: ['question', 'quote'] }) },
  },
  required: ['looks_like_training_plan', 'reason', 'method_name', 'level_hint', 'variants', 'days', 'open_questions'],
})

const nullableString = { type: ['string', 'null'] }
export const dayExtractionJsonSchema = strictSchema({
  properties: {
    exercises: { type: 'array', items: strictSchema({
      properties: {
        name: { type: 'string' }, quote: { type: 'string' },
        role_hint: { type: ['string', 'null'], enum: ['primary', 'secondary', 'accessory', 'isolation', null] },
        sets_phrase: nullableString, reps_phrase: nullableString, rest_phrase: nullableString,
        rest_between_exercises_phrase: nullableString, duration_phrase: nullableString,
        distance_phrase: nullableString, failure_phrase: nullableString, per_side_phrase: nullableString,
        equipment_hint: nullableString, variant_label: nullableString,
        alternatives: { type: 'array', items: strictSchema({ properties: { name: { type: 'string' }, quote: { type: 'string' } }, required: ['name', 'quote'] }) },
        cues: { type: 'array', items: strictSchema({ properties: { text: { type: 'string' }, quote: { type: 'string' } }, required: ['text', 'quote'] }) },
      },
      required: ['name', 'quote', 'role_hint', 'sets_phrase', 'reps_phrase', 'rest_phrase', 'rest_between_exercises_phrase', 'duration_phrase', 'distance_phrase', 'failure_phrase', 'per_side_phrase', 'equipment_hint', 'variant_label', 'alternatives', 'cues'],
    }) },
    warmup_notes: { type: 'array', items: strictSchema({ properties: { text: { type: 'string' }, quote: { type: 'string' } }, required: ['text', 'quote'] }) },
    cooldown_notes: { type: 'array', items: strictSchema({ properties: { text: { type: 'string' }, quote: { type: 'string' } }, required: ['text', 'quote'] }) },
  },
  required: ['exercises', 'warmup_notes', 'cooldown_notes'],
})
