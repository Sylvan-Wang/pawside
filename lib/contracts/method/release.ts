import { z } from 'zod'

export const ReleaseGateStatusSchema = z.enum(['pending', 'passed', 'blocked'])
export const ReleaseChannelSchema = z.enum(['internal_beta', 'production'])
export const ReleasePolicySchema = z.enum(['v1_runtime', 'strict_method'])

export const ReleaseIssueSchema = z.object({
  issueKey: z.string().min(1),
  scope: z.string().min(1),
  status: z.enum(['open', 'resolved', 'accepted_runtime_default']),
  blocksV1RuntimeRelease: z.boolean(),
  blocksStrictMethodRelease: z.boolean(),
  sourceNote: z.string().nullable().default(null),
})

export const ReleaseGateSummarySchema = z.object({
  runtime: ReleaseGateStatusSchema,
  strict: ReleaseGateStatusSchema,
  issues: z.array(ReleaseIssueSchema),
})

export type ReleaseIssue = z.infer<typeof ReleaseIssueSchema>
export type ReleaseGateSummary = z.infer<typeof ReleaseGateSummarySchema>
