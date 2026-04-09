/**
 * Unified AI client — supports OpenAI and DeepSeek (OpenAI-compatible API).
 * Model is selected per-request based on user's preferred_model setting.
 */

export type AIModel = 'openai' | 'deepseek'

export interface DailyReviewResponse {
  summary: string
  insights: string[]
  actions: string[]
  data_quality_tip: string
  tone: string
  cached: boolean
}

// If CF_AI_GATEWAY_URL is set, route through Cloudflare AI Gateway
// e.g. https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}
const CF_GATEWAY = process.env.CF_AI_GATEWAY_URL?.replace(/\/$/, '')

const OPENAI_BASE = CF_GATEWAY
  ? `${CF_GATEWAY}/openai`           // → Cloudflare proxies to api.openai.com
  : 'https://api.openai.com/v1'

// DeepSeek is OpenAI-compatible; CF Gateway Universal endpoint wraps it
const DEEPSEEK_BASE = CF_GATEWAY
  ? `${CF_GATEWAY}/deepseek`         // CF natively supports DeepSeek since Jan 2025
  : 'https://api.deepseek.com/v1'

const SYSTEM_PROMPT = `You are an AI fitness review assistant for Pawside (爪边), a fitness tracking app.

Your job is to analyze a user's daily workout and nutrition data and generate a structured daily review IN CHINESE.

Goals:
1. Help user understand today's performance
2. Highlight key insights based on actual data
3. Provide actionable next steps

Rules:
- Be specific and practical — base everything on the data provided
- Avoid vague advice like "eat more protein". Instead say "明天早餐加 2 个鸡蛋可补充约 12g 蛋白质"
- Base tone and evaluation on user's goal (lose_fat / gain_muscle / maintain)
- If data is incomplete, explicitly acknowledge it in data_quality_tip
- Do NOT give medical advice
- Do NOT hallucinate or invent numbers not present in the data
- Keep tone supportive but honest — use "warning" tone when calorie or protein flags indicate a real issue
- Actions MUST be: executable, specific, low-friction (something user can do tomorrow)
- Generate 2-3 insights and 1-3 actions maximum
- All text output must be in Chinese (中文)

Output ONLY valid JSON matching this exact schema, no other text:
{
  "summary": "string (max 50 chars, one-sentence overview)",
  "insights": ["string", "string"],
  "actions": ["string", "string"],
  "data_quality_tip": "string (empty string if data is complete)",
  "tone": "encouraging | neutral | warning"
}`

function buildUserMessage(data: object): string {
  return `以下是用户今天的健身数据，请生成复盘：\n\n${JSON.stringify(data, null, 2)}`
}

export async function callAI(
  model: AIModel,
  data: object,
): Promise<DailyReviewResponse | null> {
  // Fallback: if requested model has no key, try the other one
  const resolvedModel: AIModel =
    (model === 'openai' && !process.env.OPENAI_API_KEY && process.env.DEEPSEEK_API_KEY)
      ? 'deepseek'
      : (model === 'deepseek' && !process.env.DEEPSEEK_API_KEY && process.env.OPENAI_API_KEY)
      ? 'openai'
      : model

  const isDeepSeek = resolvedModel === 'deepseek'
  const apiKey = isDeepSeek
    ? process.env.DEEPSEEK_API_KEY
    : process.env.OPENAI_API_KEY
  const baseURL = isDeepSeek ? DEEPSEEK_BASE : OPENAI_BASE
  const modelName = isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini'

  if (!apiKey) {
    console.warn(`[ai-client] Missing API key for model: ${resolvedModel}`)
    return null
  }

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(data) },
        ],
        temperature: 0.7,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[ai-client] API error (${res.status}):`, err)
      return null
    }

    const json = await res.json()
    const content = json.choices?.[0]?.message?.content
    if (!content) return null

    let parsed: DailyReviewResponse
    try {
      parsed = JSON.parse(content) as DailyReviewResponse
    } catch {
      console.error('[ai-client] JSON parse failed, content:', content)
      return null
    }

    // Schema validation — require minimum shape
    if (
      typeof parsed.summary !== 'string' ||
      !Array.isArray(parsed.insights) ||
      !Array.isArray(parsed.actions)
    ) {
      console.error('[ai-client] Invalid schema from AI:', parsed)
      return null
    }

    parsed.cached = false
    return parsed
  } catch (e) {
    console.error('[ai-client] Unexpected error:', e)
    return null
  }
}
