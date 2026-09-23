import { z } from 'zod'
import { ReleaseGateSummarySchema } from './release.ts'

export const CanonicalRowSchema = z.record(z.string(), z.unknown())

export const CanonicalSheetSchema = z.object({
  name: z.string(),
  headerRow: z.number().int().positive(),
  headers: z.array(z.string()),
  rows: z.array(CanonicalRowSchema),
})

export const CanonicalWorkbookSchema = z.object({
  workbookPath: z.string(),
  workbookVersion: z.string(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sheets: z.record(z.string(), CanonicalSheetSchema),
})

export const ValidationFindingSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  sheet: z.string().nullable().default(null),
  row: z.number().int().positive().nullable().default(null),
})

export const CanonicalValidationReportSchema = z.object({
  importerVersion: z.string(),
  workbookVersion: z.string(),
  workbookChecksumSha256: z.string(),
  valid: z.boolean(),
  rowCounts: z.record(z.string(), z.number().int().nonnegative()),
  gates: ReleaseGateSummarySchema,
  findings: z.array(ValidationFindingSchema),
})

export type CanonicalWorkbook = z.infer<typeof CanonicalWorkbookSchema>
export type CanonicalValidationReport = z.infer<typeof CanonicalValidationReportSchema>
