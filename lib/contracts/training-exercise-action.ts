import { z } from 'zod'

export const trainingExerciseActionSchema = z.object({
  action: z.enum(['skip', 'resume']),
})

export type TrainingExerciseAction = z.infer<typeof trainingExerciseActionSchema>
