import { z } from 'zod'

export const saveSetActualSchema = z.object({
  exercise_execution_id: z.string().uuid(),
  set_index: z.number().int().positive().max(50),
  actual_weight_kg: z.number().finite().min(0).max(1000).nullable().optional(),
  actual_reps: z.number().int().min(0).max(1000),
  actual_rir: z.number().finite().min(0).max(20).nullable().optional(),
})

export const completeTrainingSessionSchema = z.object({
  duration_minutes: z.number().int().positive().max(1440).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type SaveSetActualInput = z.infer<typeof saveSetActualSchema>
export type CompleteTrainingSessionInput = z.infer<typeof completeTrainingSessionSchema>
