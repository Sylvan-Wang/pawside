import { describe, expect, it, vi } from 'vitest'

const responses: unknown[] = []

vi.mock('../../lib/ai-client.ts', () => ({
  getOpenAIConfigStatus: () => ({ model: 'test-model' }),
  callStructuredOutput: vi.fn(async () => {
    const next = responses.shift()
    return { ok: true, data: next, model: 'test-model' }
  }),
}))

const { composeWithEvidence } = await import('../../lib/evidence/composer.ts')
const { buildCoachOutputSchema, COACH_OUTPUT_PROMPT_VERSIONS } = await import('../../lib/evidence/coach-output.ts')

function coachOutput(overrides: Record<string, unknown> = {}) {
  return {
    headline: '今天蛋白还差 {{nutrition.protein_remaining}}',
    primary_focus: { signal_keys: ['nutrition.protein'], why_now: 'x' },
    evidence: [],
    next_actions: [],
    data_quality_tip: null,
    safety: { level: 'none', text: null, evidence_ref_ids: [] },
    ...overrides,
  }
}

describe('composer with a coach_output_v1 schemaOverride (spec A0-4 wiring)', () => {
  it('renders placeholders and reports the override bundle promptVersion', async () => {
    responses.length = 0
    responses.push(coachOutput())
    const result = await composeWithEvidence({
      surface: 'meal_feedback',
      facts: [{ metric_key: 'nutrition.protein_remaining', value: 42, unit: 'g', window: 'day', calculation_basis: {}, data_completeness: 'complete' }],
      signals: [],
      context: {},
      schemaOverride: {
        name: 'pawside_meal_feedback_v1',
        schema: buildCoachOutputSchema('meal_feedback'),
        maxOutputTokens: 400,
        promptVersion: COACH_OUTPUT_PROMPT_VERSIONS.meal_feedback,
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.promptVersion).toBe(COACH_OUTPUT_PROMPT_VERSIONS.meal_feedback)
      expect((result.data as { headline: string }).headline).toBe('今天蛋白还差 42 g')
    }
  })

  it('rejects a bare digit even under schemaOverride (placeholder mode is implied)', async () => {
    responses.length = 0
    responses.push(coachOutput({ headline: '今天蛋白还差 42g' }))
    responses.push(coachOutput({ headline: '今天蛋白还差 42g' }))
    const result = await composeWithEvidence({
      surface: 'meal_feedback',
      facts: [],
      signals: [],
      context: {},
      schemaOverride: {
        name: 'pawside_meal_feedback_v1',
        schema: buildCoachOutputSchema('meal_feedback'),
        maxOutputTokens: 400,
        promptVersion: COACH_OUTPUT_PROMPT_VERSIONS.meal_feedback,
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bare_number')
  })
})
