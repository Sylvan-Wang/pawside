import { z } from 'zod'

const sessionMinutesSchema = z.union([
  z.literal(30),
  z.literal(45),
  z.literal(60),
  z.literal(90),
])

export const startTrainingSessionSchema = z.object({
  view_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_zone: z.string().trim().min(1).max(100),
  start_request_id: z.string().uuid(),
  selected_session_minutes: sessionMinutesSchema.optional(),
  selection_source: z.enum(['profile_default', 'user_override']).optional(),
})

export const saveSetActualSchema = z.object({
  exercise_execution_id: z.string().uuid(),
  set_index: z.number().int().positive().max(50),
  actual_weight_kg: z.number().finite().min(0).max(1000).nullable().optional(),
  actual_reps: z.number().int().min(0).max(1000),
  actual_rir: z.number().finite().min(0).max(20).nullable().optional(),
})

export const completeTrainingSessionSchema = z.object({
  completion_request_id: z.string().uuid(),
  duration_minutes: z.number().int().positive().max(1440).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export const updateTrainingDurationSchema = z.object({
  selected_session_minutes: sessionMinutesSchema,
  selection_source: z.literal('mid_session_change'),
})

export type StartTrainingSessionInput = z.infer<typeof startTrainingSessionSchema>
export type SaveSetActualInput = z.infer<typeof saveSetActualSchema>
export type CompleteTrainingSessionInput = z.infer<typeof completeTrainingSessionSchema>
export type UpdateTrainingDurationInput = z.infer<typeof updateTrainingDurationSchema>
