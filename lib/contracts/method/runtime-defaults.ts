import { z } from 'zod'
import { FieldProvenanceSchema } from './authority.ts'

const RepRangeSchema = z.object({
  min: z.number().int().positive(),
  max: z.number().int().positive(),
  perSide: z.boolean().default(false),
})

const RuntimeExercisePrescriptionSchema = z.object({
  exerciseKey: z.string(),
  canonicalNameZh: z.string(),
  splitKey: z.enum(['pull', 'legs']),
  sets: FieldProvenanceSchema,
  reps: FieldProvenanceSchema.extend({ value: RepRangeSchema }),
  failurePolicy: FieldProvenanceSchema,
  progression: FieldProvenanceSchema,
})

export type RuntimeExercisePrescription = z.infer<typeof RuntimeExercisePrescriptionSchema>

const productDefault = <T>(value: T, evidenceKey: string, sourceNote: string) => ({
  value,
  authority: 'product_execution_default' as const,
  runtimeStatus: 'fallback_active' as const,
  confidence: 'high' as const,
  evidenceKeys: [evidenceKey],
  sourceNote,
})

const methodExplicit = <T>(value: T, evidenceKeys: string[], sourceNote: string) => ({
  value,
  authority: 'method_explicit' as const,
  runtimeStatus: 'active' as const,
  confidence: 'high' as const,
  evidenceKeys,
  sourceNote,
})

const calibrationOnly = (evidenceKey: string) =>
  productDefault(
    { type: 'calibration_only', methodStage: null },
    evidenceKey,
    'Calibration may change reference_weight only. It must not create or advance method_stage.',
  )

export const P0_RUNTIME_DEFAULTS = RuntimeExercisePrescriptionSchema.array().parse([
  {
    exerciseKey: 'seated_shoulder_flexed_cable_curl',
    canonicalNameZh: '坐姿肩屈位绳索弯举',
    splitKey: 'pull',
    sets: methodExplicit(3, ['EV-CURL-001'], 'The Method directly supports three sets.'),
    reps: productDefault(
      { min: 12, max: 15, perSide: false },
      'EV-P0-CURL-DEFAULT',
      'The Method does not provide a unique structured rep prescription. Pawside V1 uses 12–15.',
    ),
    failurePolicy: productDefault(
      { firstSets: 'not_required', finalSet: 'technical_failure_allowed' },
      'EV-P0-CURL-DEFAULT',
      'The final set may approach technical failure; failure is not required for every set.',
    ),
    progression: calibrationOnly('EV-P0-CURL-DEFAULT'),
  },
  {
    exerciseKey: 'single_leg_deadlift',
    canonicalNameZh: '单腿硬拉',
    splitKey: 'legs',
    sets: productDefault(3, 'EV-P0-DAY3-DEFAULT', 'Pawside V1 starting volume.'),
    reps: productDefault(
      { min: 12, max: 12, perSide: true },
      'EV-P0-DAY3-DEFAULT',
      'Pawside V1 starting rep target per side.',
    ),
    failurePolicy: methodExplicit(
      { initialPhase: 'avoid_failure' },
      ['EV-LOWER-001'],
      'The initial lower-body phase generally avoids failure.',
    ),
    progression: calibrationOnly('EV-P0-DAY3-DEFAULT'),
  },
  {
    exerciseKey: 'bulgarian_split_squat',
    canonicalNameZh: '保加利亚分腿蹲',
    splitKey: 'legs',
    sets: productDefault(3, 'EV-P0-DAY3-DEFAULT', 'Pawside V1 starting volume.'),
    reps: productDefault(
      { min: 10, max: 12, perSide: true },
      'EV-P0-DAY3-DEFAULT',
      'Pawside V1 starting rep range per side.',
    ),
    failurePolicy: methodExplicit(
      { initialPhase: 'avoid_failure' },
      ['EV-LOWER-001'],
      'The initial lower-body phase generally avoids failure.',
    ),
    progression: calibrationOnly('EV-P0-DAY3-DEFAULT'),
  },
  {
    exerciseKey: 'front_squat',
    canonicalNameZh: '前蹲/颈前深蹲',
    splitKey: 'legs',
    sets: methodExplicit(3, ['EV-LOWER-001'], 'The Method directly supports three sets.'),
    reps: productDefault(
      { min: 12, max: 15, perSide: false },
      'EV-P0-DAY3-DEFAULT',
      'Pawside V1 starting rep range.',
    ),
    failurePolicy: methodExplicit(
      { initialPhase: 'avoid_failure' },
      ['EV-LOWER-001'],
      'The initial lower-body phase generally avoids failure.',
    ),
    progression: calibrationOnly('EV-P0-DAY3-DEFAULT'),
  },
  {
    exerciseKey: 'romanian_deadlift',
    canonicalNameZh: '罗马尼亚硬拉',
    splitKey: 'legs',
    sets: methodExplicit(3, ['EV-LOWER-001'], 'The Method directly supports three sets.'),
    reps: productDefault(
      { min: 10, max: 12, perSide: false },
      'EV-P0-DAY3-DEFAULT',
      'Pawside V1 starting rep range.',
    ),
    failurePolicy: methodExplicit(
      { initialPhase: 'avoid_failure' },
      ['EV-LOWER-001'],
      'The initial lower-body phase generally avoids failure.',
    ),
    progression: calibrationOnly('EV-P0-DAY3-DEFAULT'),
  },
  {
    exerciseKey: 'back_extension',
    canonicalNameZh: '山羊挺身',
    splitKey: 'legs',
    sets: methodExplicit(3, ['EV-LOWER-001'], 'The Method directly supports three sets.'),
    reps: methodExplicit(
      { min: 8, max: 8, perSide: false },
      ['EV-LOWER-001'],
      'The Method directly supports eight reps in the back-extension execution context.',
    ),
    failurePolicy: methodExplicit(
      { initialPhase: 'avoid_failure' },
      ['EV-LOWER-001'],
      'The initial lower-body phase generally avoids failure.',
    ),
    progression: calibrationOnly('EV-P0-DAY3-DEFAULT'),
  },
])
