import { z } from 'zod'

export const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'] as const

const per100gSchema = z.object({
  basis_type: z.string().default('per_100g'),
  energy_kcal: z.number().nullable(),
  protein_g: z.number().nullable(),
  carb_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  fiber_g: z.number().nullable().optional(),
  sodium_mg: z.number().nullable().optional(),
})

export const nutritionItemSchema = z.object({
  food_id: z.number().int().nullable().default(null),
  food_name_raw: z.string().trim().min(1),
  food_name_resolved: z.string().nullable().default(null),
  weight_g: z.number().positive(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  is_estimated: z.boolean().optional(),
  resolution_source: z.enum([
    'user_memory',
    'canonical_db',
    'candidate_cache',
    'ai_estimate',
    'user_override',
  ]),
  source_ref_id: z.string().nullable().default(null),
  user_confirmed: z.boolean(),
  // Kept only for display compatibility. Persistence reloads the authoritative
  // reference row by food_id and never trusts these browser-provided numbers.
  per100g: per100gSchema.nullable().default(null),
  fallback: z.object({
    calories_kcal: z.number().nonnegative().nullable().optional(),
    protein_g: z.number().nonnegative().nullable().optional(),
    carbs_g: z.number().nonnegative().nullable().optional(),
    fat_g: z.number().nonnegative().nullable().optional(),
  }).optional(),
})

const foodLogBaseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.enum(mealTypes),
  raw_input_text: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(nutritionItemSchema).min(1),
})

export const createFoodLogBodySchema = foodLogBaseSchema.extend({
  request_id: z.string().uuid(),
})

export const replaceFoodLogBodySchema = foodLogBaseSchema.extend({
  request_id: z.string().uuid(),
  expected_updated_at: z.string().datetime({ offset: true }).nullable().optional(),
})

export function normalizeMealType(value: unknown): typeof mealTypes[number] | null {
  const aliases: Record<string, typeof mealTypes[number]> = {
    breakfast: 'breakfast',
    lunch: 'lunch',
    dinner: 'dinner',
    snack: 'snack',
    '早餐': 'breakfast',
    '午餐': 'lunch',
    '晚餐': 'dinner',
    '加餐': 'snack',
  }
  return typeof value === 'string' ? aliases[value] ?? null : null
}
