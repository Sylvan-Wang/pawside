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

const OPENAI_BASE = 'https://api.openai.com/v1'
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'

const SYSTEM_PROMPT = `你是爪边 Pawside 的 AI 健身教练，负责帮助用户做每日训练和饮食复盘。

你会收到用户当天的训练和饮食数据，以 JSON 格式提供。你的任务是：
1. 给出一句话的今日总结（summary）
2. 2-3 条具体的观察（insights）
3. 1-3 条明天或接下来的行动建议（actions）
4. 若数据有明显缺失或异常，给出一句温和的提示（data_quality_tip），否则留空字符串

风格要求：
- 中文回复
- 语气积极鼓励（encouraging）
- 具体，基于数据，避免空话
- 简洁，不要超过指定字数

你必须严格按照以下 JSON schema 输出，不要输出任何其他内容：
{
  "summary": "string, 不超过50字",
  "insights": ["string", "string"],
  "actions": ["string", "string"],
  "data_quality_tip": "string 或空字符串",
  "tone": "encouraging"
}`

function buildUserMessage(data: object): string {
  return `以下是用户今天的健身数据，请生成复盘：\n\n${JSON.stringify(data, null, 2)}`
}

export async function callAI(
  model: AIModel,
  data: object,
): Promise<DailyReviewResponse | null> {
  const isDeepSeek = model === 'deepseek'
  const apiKey = isDeepSeek
    ? process.env.DEEPSEEK_API_KEY
    : process.env.OPENAI_API_KEY
  const baseURL = isDeepSeek ? DEEPSEEK_BASE : OPENAI_BASE
  const modelName = isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini'

  if (!apiKey) {
    console.warn(`[ai-client] Missing API key for model: ${model}`)
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

    const parsed = JSON.parse(content) as DailyReviewResponse
    parsed.cached = false
    return parsed
  } catch (e) {
    console.error('[ai-client] Unexpected error:', e)
    return null
  }
}
