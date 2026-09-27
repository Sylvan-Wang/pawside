import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelCalls: string[] = []
let responses: unknown[] = []

vi.mock('../../lib/ai-client.ts', () => ({
  getOpenAIConfigStatus: () => ({ model: 'test-model' }),
  callStructuredOutput: vi.fn(async (_system: string, user: string) => {
    modelCalls.push(user)
    const next = responses.shift()
    if (next === 'PROVIDER_FAIL') return { ok: false, reason: 'upstream_error', model: 'test-model' }
    return { ok: true, data: next, model: 'test-model' }
  }),
}))

const logCalls: Array<{ status: string; failReason: string | null; attempt: number }> = []
let logShouldThrow = false

vi.mock('../../lib/ai/generation-log.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai/generation-log.ts')>()
  return {
    ...actual,
    logGeneration: vi.fn(async (record: { status: string; failReason?: string | null; attempt?: number }) => {
      if (logShouldThrow) throw new Error('supabase is down')
      logCalls.push({ status: record.status, failReason: record.failReason ?? null, attempt: record.attempt ?? 1 })
      return 'gen-id'
    }),
  }
})

const { composeWithEvidence } = await import('../../lib/evidence/composer.ts')

function output(summary: string) {
  return {
    summary,
    observations: [],
    next_actions: [],
    data_quality_tip: null,
  }
}

const baseInput = {
  surface: 'workout_session_feedback' as const,
  facts: [],
  signals: [],
  context: {},
  instructions: 'test',
  userId: 'user-1',
  scopeId: 'log-1',
}

describe('spec A0-3 — composeWithEvidence writes ai_generations per attempt', () => {
  beforeEach(() => {
    modelCalls.length = 0
    logCalls.length = 0
    responses = []
    logShouldThrow = false
  })

  it('logs one ok row for a clean first attempt', async () => {
    responses = [output('卧推三组都按计划完成')]
    const result = await composeWithEvidence(baseInput)
    expect(result.ok).toBe(true)
    expect(logCalls).toEqual([{ status: 'ok', failReason: null, attempt: 1 }])
  })

  it('logs a failed row then an ok row across the guard retry', async () => {
    responses = [output('记录为 partial'), output('这次推训练完成得很稳')]
    const result = await composeWithEvidence({ ...baseInput, outputGuard: true })
    expect(result.ok).toBe(true)
    expect(logCalls).toEqual([
      { status: 'failed', failReason: 'internal_term', attempt: 1 },
      { status: 'ok', failReason: null, attempt: 2 },
    ])
  })

  it('logs a failed row for a provider failure, with no retry', async () => {
    responses = ['PROVIDER_FAIL']
    const result = await composeWithEvidence(baseInput)
    expect(result.ok).toBe(false)
    expect(logCalls).toEqual([{ status: 'failed', failReason: 'upstream_error', attempt: 1 }])
  })

  it('logs the unbound_evidence failure before ever calling the model', async () => {
    const result = await composeWithEvidence({
      ...baseInput,
      signals: [{
        metric_key: 'x', status: 'warning', evidence_ref_ids: [], domain: 'training_optimization' as const,
        evidence_level: null, confidence: 'high' as const, allowed_claim: null, authority: 'someone said so',
      }],
    })
    expect(result.ok).toBe(false)
    expect(modelCalls).toHaveLength(0)
    expect(logCalls).toEqual([{ status: 'failed', failReason: 'unbound_evidence', attempt: 1 }])
  })

  it('does not log at all when the caller has no userId (e.g. a test stub)', async () => {
    responses = [output('卧推三组都按计划完成')]
    const result = await composeWithEvidence({ ...baseInput, userId: undefined })
    expect(result.ok).toBe(true)
    expect(logCalls).toHaveLength(0)
  })

  it('never lets a logging failure surface as a composeWithEvidence failure', async () => {
    logShouldThrow = true
    responses = [output('卧推三组都按计划完成')]
    const result = await composeWithEvidence(baseInput)
    expect(result.ok).toBe(true)
  })
})
