import { z } from 'zod'

export const METHOD_SPLIT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/
export const MethodSplitKeySchema = z.string().regex(METHOD_SPLIT_KEY_PATTERN)

export const MethodAuthoritySchema = z.enum([
  'method_explicit',
  'official_reconstructed',
  'product_execution_default',
  'unresolved',
  'library_default',
  'ai_inferred',
  'user_corrected',
])

const ConfidenceSchema = z.enum(['high', 'medium', 'low'])

export function sourcedSchema<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullable(),
    authority: MethodAuthoritySchema,
    quote: z.string().nullable(),
    confidence: ConfidenceSchema,
    note: z.string().nullable(),
  }).superRefine((field, context) => {
    if (field.authority === 'method_explicit' && !field.quote?.trim()) {
      context.addIssue({ code: 'custom', path: ['quote'], message: '原文明写的值必须带原文引用' })
    }
  })
}

const RepRangeSchema = z.object({
  min: z.number().int().min(1).max(100),
  max: z.number().int().min(1).max(100),
  perSide: z.boolean(),
}).refine((range) => range.min <= range.max, { message: '次数下限不能大于上限' })

const RestRangeSchema = z.object({
  min: z.number().int().min(0).max(600),
  max: z.number().int().min(0).max(600),
}).refine((range) => range.min <= range.max, { message: '休息下限不能大于上限' })

export const MethodSetTemplateSchema = z.object({
  type: z.enum(['warmup', 'working', 'failure', 'rest_pause', 'backoff', 'other']),
  reps: sourcedSchema(RepRangeSchema).nullable(),
  durationSeconds: sourcedSchema(z.number().int().min(1).max(7200)).nullable(),
  distanceM: sourcedSchema(z.number().positive()).nullable(),
  restSeconds: sourcedSchema(RestRangeSchema).nullable(),
  failure: z.enum(['avoid', 'allowed', 'required']),
  optional: z.boolean().default(false),
  qualityNote: z.string().nullable(),
})

export const MethodExerciseRefSchema = z.object({
  name: z.string().trim().min(1).max(40),
  exerciseId: z.string().uuid().nullable(),
  match: z.enum(['exact', 'alias', 'candidate']),
})

export const MethodExerciseEntrySchema = z.object({
  ref: MethodExerciseRefSchema,
  role: z.enum(['primary', 'secondary', 'accessory', 'isolation', 'development']),
  sets: z.array(MethodSetTemplateSchema).min(1).max(40),
  substitutions: z.array(MethodExerciseRefSchema).default([]),
  cues: z.array(z.string().trim().min(1).max(200)).default([]),
  notes: z.string().nullable(),
})

export const MethodDaySchema = z.object({
  key: MethodSplitKeySchema,
  nameZh: z.string().trim().min(1).max(40),
  order: z.number().int().positive(),
  dayType: z.enum(['strength', 'core', 'cardio']),
  required: z.boolean(),
  minGapDays: z.number().int().min(0).max(7),
  focusRegions: z.array(z.string().trim().min(1).max(40)),
  warmupNotes: z.array(z.string().trim().min(1).max(200)).default([]),
  cooldownNotes: z.array(z.string().trim().min(1).max(200)).default([]),
  exercises: z.array(MethodExerciseEntrySchema).max(12),
})

export const MethodManifestSchema = z.object({
  schemaVersion: z.literal(2),
  method: z.object({
    nameZh: z.string().trim().min(1).max(80),
    summary: z.string().max(1000).nullable(),
    level: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
    equipmentRequirement: z.enum(['none', 'home', 'full_gym']).nullable(),
  }),
  source: z.object({
    kind: z.enum(['pasted_text', 'workbook']),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().max(200).nullable(),
  }),
  days: z.array(MethodDaySchema).min(1).max(14),
  openQuestions: z.array(z.object({
    path: z.string().min(1).max(300),
    question: z.string().min(1).max(500),
  })),
  consent: z.object({
    version: z.string().min(1).max(40),
    acceptedAt: z.string().datetime(),
  }).nullable(),
}).superRefine((manifest, context) => {
  const keys = new Set<string>()
  const orders = new Set<number>()
  manifest.days.forEach((day, dayIndex) => {
    if (keys.has(day.key)) context.addIssue({ code: 'custom', path: ['days', dayIndex, 'key'], message: '分化键不能重复' })
    if (orders.has(day.order)) context.addIssue({ code: 'custom', path: ['days', dayIndex, 'order'], message: '分化顺序不能重复' })
    keys.add(day.key)
    orders.add(day.order)

    const totalSets = day.exercises.reduce((total, exercise) => total + exercise.sets.length, 0)
    if (totalSets > 40) context.addIssue({ code: 'custom', path: ['days', dayIndex, 'exercises'], message: '每天总组数不能超过 40' })
  })
})

export type MethodManifest = z.infer<typeof MethodManifestSchema>
