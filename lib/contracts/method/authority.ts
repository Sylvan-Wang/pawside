import { z } from 'zod'

export const SourceAuthoritySchema = z.enum([
  'method_explicit',
  'official_reconstructed',
  'product_execution_default',
  'unresolved',
])

export const RuntimeStatusSchema = z.enum([
  'active',
  'fallback_active',
  'inactive',
])

export const ConfidenceSchema = z.enum(['high', 'medium', 'low'])

export const FieldProvenanceSchema = z.object({
  value: z.unknown(),
  authority: SourceAuthoritySchema,
  runtimeStatus: RuntimeStatusSchema,
  confidence: ConfidenceSchema,
  evidenceKeys: z.array(z.string()).default([]),
  sourceNote: z.string().nullable().default(null),
})

export type SourceAuthority = z.infer<typeof SourceAuthoritySchema>
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>
