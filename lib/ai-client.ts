/**
 * Pawside OpenAI client.
 *
 * Server-only: never import this module from a Client Component and never expose
 * OPENAI_API_KEY through a NEXT_PUBLIC_* variable.
 */

export const DAILY_REVIEW_PROMPT_VERSION = 'openai_daily_review_v2'
export const ADVISORY_PLAN_PROMPT_VERSION = 'openai_advisory_plan_v1'

export type OpenAIFailureReason =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_response'

export type OpenAIResult<T> =
  | { ok: true; data: T; provider: 'openai'; model: string }
  | { ok: false; reason: OpenAIFailureReason; provider: 'openai'; model: string }

export interface DailyReviewPayload {
  summary: string
  insights: string[]
  actions: string[]
  data_quality_tip: string
  tone: 'encouraging' | 'neutral' | 'warning'
}

export interface AdvisoryPlanPayload {
  title: string
  summary: string
  recommendations: {
    title: string
    action: string
    rationale: string
  }[]
  cautions: string[]
}

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-luna'
const configuredTimeout = Number(process.env.OPENAI_TIMEOUT_MS)
const OPENAI_TIMEOUT_MS =
  Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000 && configuredTimeout <= 60_000
    ? configuredTimeout
    : 20_000

const DAILY_REVIEW_SYSTEM_PROMPT = `You are an AI fitness review assistant for Pawside (爪边), a fitness tracking app.

Analyze the user's daily workout and nutrition data and generate a structured daily review in Chinese.

Rules:
- Base every observation on supplied data. Never invent measurements or completed activities.
- Give specific, low-friction actions for the next day.
- Respect the user's goal and explicitly identify incomplete data.
- Do not diagnose disease, prescribe medication, or replace professional medical care.
- Keep the tone supportive but honest.
- Provide 2-3 insights and 1-3 actions at most.
- All user-facing text must be Chinese.`

const ADVISORY_PLAN_SYSTEM_PROMPT = `You create concise Chinese fitness or nutrition advisory drafts for Pawside (爪边).

Rules:
- Use only the supplied input and label uncertainty in the recommendations.
- Do not diagnose disease, prescribe medication, or replace professional medical care.
- Keep every recommendation specific and practical.
- This output is a legacy advisory draft. It is NOT the Pawside Method, enrollment state, progression truth, recovery decision, or training prescription.
- Never claim that the user has entered, advanced, or completed a Pawside Method cycle.
- All user-facing text must be Chinese.`

const dailyReviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', maxLength: 50 },
    insights: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string' },
    },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string' },
    },
    data_quality_tip: { type: 'string' },
    tone: { type: 'string', enum: ['encouraging', 'neutral', 'warning'] },
  },
  required: ['summary', 'insights', 'actions', 'data_quality_tip', 'tone'],
} as const

const advisoryPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 60 },
    summary: { type: 'string', maxLength: 240 },
    recommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 60 },
          action: { type: 'string', maxLength: 240 },
          rationale: { type: 'string', maxLength: 240 },
        },
        required: ['title', 'action', 'rationale'],
      },
    },
    cautions: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string' },
    },
  },
  required: ['title', 'summary', 'recommendations', 'cautions'],
} as const

export function getOpenAIConfigStatus() {
  return {
    provider: 'openai' as const,
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: OPENAI_MODEL,
    api: 'responses' as const,
  }
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const response = payload as {
    output_text?: unknown
    output?: { content?: { type?: unknown; text?: unknown }[] }[]
  }

  if (typeof response.output_text === 'string') return response.output_text

  const parts = response.output
    ?.flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text as string)

  return parts?.length ? parts.join('') : null
}

async function callStructuredOutput<T>(
  instructions: string,
  input: string,
  schemaName: string,
  schema: object,
  validate: (value: unknown) => value is T,
  maxOutputTokens: number,
): Promise<OpenAIResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    console.warn('[ai-client] OPENAI_API_KEY is not configured')
    return { ok: false, reason: 'not_configured', provider: 'openai', model: OPENAI_MODEL }
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    })

    if (!response.ok) {
      const requestId = response.headers.get('x-request-id') || 'unavailable'
      console.error(
        `[ai-client] OpenAI request failed status=${response.status} request_id=${requestId}`,
      )
      return {
        ok: false,
        reason: response.status === 429 ? 'rate_limited' : 'upstream_error',
        provider: 'openai',
        model: OPENAI_MODEL,
      }
    }

    const outputText = extractOutputText(await response.json())
    if (!outputText) {
      console.error('[ai-client] OpenAI response did not contain output text')
      return { ok: false, reason: 'invalid_response', provider: 'openai', model: OPENAI_MODEL }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(outputText)
    } catch {
      console.error('[ai-client] OpenAI structured output was not valid JSON')
      return { ok: false, reason: 'invalid_response', provider: 'openai', model: OPENAI_MODEL }
    }

    if (!validate(parsed)) {
      console.error('[ai-client] OpenAI structured output failed local validation')
      return { ok: false, reason: 'invalid_response', provider: 'openai', model: OPENAI_MODEL }
    }

    return { ok: true, data: parsed, provider: 'openai', model: OPENAI_MODEL }
  } catch (error) {
    const isTimeout = error instanceof Error && (
      error.name === 'AbortError' || error.name === 'TimeoutError'
    )
    console.error(`[ai-client] OpenAI request ${isTimeout ? 'timed out' : 'failed unexpectedly'}`)
    return {
      ok: false,
      reason: isTimeout ? 'timeout' : 'upstream_error',
      provider: 'openai',
      model: OPENAI_MODEL,
    }
  }
}

function isDailyReviewPayload(value: unknown): value is DailyReviewPayload {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<DailyReviewPayload>
  return (
    typeof item.summary === 'string' &&
    item.summary.length <= 50 &&
    Array.isArray(item.insights) &&
    item.insights.length >= 1 &&
    item.insights.length <= 3 &&
    item.insights.every(entry => typeof entry === 'string') &&
    Array.isArray(item.actions) &&
    item.actions.length >= 1 &&
    item.actions.length <= 3 &&
    item.actions.every(entry => typeof entry === 'string') &&
    typeof item.data_quality_tip === 'string' &&
    ['encouraging', 'neutral', 'warning'].includes(item.tone || '')
  )
}

function isAdvisoryPlanPayload(value: unknown): value is AdvisoryPlanPayload {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<AdvisoryPlanPayload>
  return (
    typeof item.title === 'string' &&
    typeof item.summary === 'string' &&
    Array.isArray(item.recommendations) &&
    item.recommendations.length >= 1 &&
    item.recommendations.length <= 8 &&
    item.recommendations.every(recommendation =>
      recommendation &&
      typeof recommendation.title === 'string' &&
      typeof recommendation.action === 'string' &&
      typeof recommendation.rationale === 'string'
    ) &&
    Array.isArray(item.cautions) &&
    item.cautions.length <= 3 &&
    item.cautions.every(entry => typeof entry === 'string')
  )
}

export function callDailyReview(data: object): Promise<OpenAIResult<DailyReviewPayload>> {
  return callStructuredOutput(
    DAILY_REVIEW_SYSTEM_PROMPT,
    `以下是用户当天的健身数据，请生成复盘：\n\n${JSON.stringify(data, null, 2)}`,
    'pawside_daily_review',
    dailyReviewSchema,
    isDailyReviewPayload,
    700,
  )
}

export function callAdvisoryPlan(
  planType: string,
  input: Record<string, unknown>,
): Promise<OpenAIResult<AdvisoryPlanPayload>> {
  return callStructuredOutput(
    ADVISORY_PLAN_SYSTEM_PROMPT,
    `计划类型：${planType}\n用户输入：\n${JSON.stringify(input, null, 2)}`,
    'pawside_advisory_plan',
    advisoryPlanSchema,
    isAdvisoryPlanPayload,
    1_200,
  )
}
