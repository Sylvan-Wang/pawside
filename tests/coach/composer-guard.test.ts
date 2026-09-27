import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
let responses: unknown[] = []

vi.mock('../../lib/ai-client.ts', () => ({
  getOpenAIConfigStatus: () => ({ model: 'test-model' }),
  callStructuredOutput: vi.fn(async (_system: string, user: string) => {
    calls.push(user)
    const next = responses.shift()
    return { ok: true, data: next, model: 'test-model' }
  }),
}))

const { composeWithEvidence } = await import('../../lib/evidence/composer.ts')

function output(summary: string, observation = '卧推主项按计划完成') {
  return {
    summary,
    observations: [{ text: observation, signal_key: 'training.session_duration', status: 'within_reference', domain: 'data_quality', evidence_ref_ids: [] }],
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
}

describe('coach output guard', () => {
  beforeEach(() => {
    calls.length = 0
    responses = []
  })

  it('retries once when internal terms leak, naming the violation', async () => {
    responses = [output('记录为 partial'), output('这次推训练完成得很稳')]
    const result = await composeWithEvidence({ ...baseInput, outputGuard: true, promptVersionSuffix: 'coach_v2' })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('内部用语')
    if (result.ok) expect(result.promptVersion).toMatch(/\+coach_v2$/)
  })

  it('fails closed when the retry still leaks', async () => {
    responses = [output('依据 AI Patch'), output('依据 AI Patch')]
    const result = await composeWithEvidence({ ...baseInput, outputGuard: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('internal_term')
  })

  it('accepts a long headline after one retry rather than truncating it', async () => {
    const long = '这是一句明显超过三十个字的总结用来测试长度检查是否只会重试一次而不会截断输出内容'
    responses = [output(long), output(long)]
    const result = await composeWithEvidence({ ...baseInput, outputGuard: true })
    expect(calls).toHaveLength(2)
    expect(result.ok).toBe(true)
  })

  it('allows rule-produced plan numbers such as 10 + 5', async () => {
    responses = [output('下次末组做 10 + 5 次')]
    const result = await composeWithEvidence({ ...baseInput, outputGuard: true, extraAllowedNumbers: [10, 5] })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('keeps the old single-call behaviour without the guard', async () => {
    responses = [output('记录为 partial')]
    const result = await composeWithEvidence(baseInput)
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
