/**
 * Does the configured OpenAI model read meal photos, and how well?
 *
 *   npm run photo:check -- meal.jpg [more.jpg ...]   one call per photo, prints what the model saw
 *   npm run photo:check -- ./photo-eval/              every image in the folder; with labels.json, scores them
 *
 * labels.json (optional, in the folder):
 *   { "lunch1.jpg": { "foods": [{ "name": "米饭", "grams": 210 }, { "name": "番茄炒蛋", "grams": 160 }] }, ... }
 * Weigh each food on a kitchen scale before eating; names only need to be recognisable.
 *
 * Needs OPENAI_API_KEY (and optionally OPENAI_CHAT_MODEL / OPENAI_MODEL) in the environment or .env.local.
 * Uses exactly the prompt and schema the app uses (lib/coach-chat/photo-recognize.ts). Costs money.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { callStructuredOutput, getChatModel, getOpenAIConfigStatus } from '../lib/ai-client.ts'
import {
  PHOTO_INSTRUCTIONS,
  PHOTO_PROMPT_VERSION,
  photoMealSchema,
  validPhotoMeal,
  type PhotoMealResult,
} from '../lib/coach-chat/photo-recognize.ts'

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('用法：npm run photo:check -- <照片或文件夹>')
  process.exit(2)
}
const status = getOpenAIConfigStatus()
if (!status.configured) {
  console.error('HOLD OPENAI_API_KEY 没有配置（放进 .env.local 或环境变量）')
  process.exit(2)
}
const model = getChatModel()

let files: string[] = []
let labels: Record<string, { foods: Array<{ name: string; grams: number }> }> = {}
for (const arg of args) {
  if (statSync(arg).isDirectory()) {
    files.push(...readdirSync(arg).filter((name) => MIME[extname(name).toLowerCase()]).sort().map((name) => join(arg, name)))
    try { labels = { ...labels, ...JSON.parse(readFileSync(join(arg, 'labels.json'), 'utf8')) } } catch { /* no labels: just print */ }
  } else {
    files.push(arg)
  }
}
files = files.filter((file) => MIME[extname(file).toLowerCase()])
console.log(`model=${model} prompt=${PHOTO_PROMPT_VERSION} photos=${files.length}${Object.keys(labels).length ? ` labelled=${Object.keys(labels).length}` : ''}`)

const sameFood = (a: string, b: string) => a === b || a.includes(b) || b.includes(a)
const latencies: number[] = []
let failures = 0
let firstHttp: number | undefined
const score = { labelled: 0, foods: 0, found: 0, extra: 0, weighed: 0, within25: 0, twoX: 0, absPct: [] as number[] }

for (const file of files) {
  const url = `data:${MIME[extname(file).toLowerCase()]};base64,${readFileSync(file).toString('base64')}`
  const started = Date.now()
  const result = await callStructuredOutput<PhotoMealResult>(
    PHOTO_INSTRUCTIONS, '这一餐的照片共 1 张。请按规则返回 JSON。', 'pawside_photo_meal_v1', photoMealSchema, validPhotoMeal, 900,
    { model, timeoutMs: 60_000, images: [url] },
  )
  const ms = Date.now() - started
  latencies.push(ms)
  const name = file.split('/').pop()!
  if (!result.ok) {
    failures += 1
    firstHttp ??= result.httpStatus
    console.log(`FAIL ${name} ${result.reason}${result.httpStatus ? ` http=${result.httpStatus}` : ''} ${ms}ms`)
    continue
  }
  const seen = result.data.foods.map((f) => `${f.name}${f.grams === null ? '' : ` ${f.grams}g`}(${f.confidence})`).join('、')
  console.log(`OK   ${name} ${ms}ms tokens=${result.usage?.inputTokens ?? '?'}/${result.usage?.outputTokens ?? '?'} ${result.data.is_meal ? seen : `不是一餐：${result.data.reason}`}${result.data.note ? ` | ${result.data.note}` : ''}`)

  const truth = labels[name]
  if (!truth) continue
  score.labelled += 1
  const used = new Set<number>()
  for (const food of truth.foods) {
    score.foods += 1
    const index = result.data.foods.findIndex((guess, i) => !used.has(i) && sameFood(guess.name, food.name))
    if (index < 0) { console.log(`       漏认：${food.name}`); continue }
    used.add(index)
    score.found += 1
    const grams = result.data.foods[index].grams
    if (grams === null) continue
    score.weighed += 1
    const pct = Math.abs(grams - food.grams) / food.grams
    score.absPct.push(pct)
    if (pct <= 0.25) score.within25 += 1
    if (grams >= food.grams * 2 || grams <= food.grams / 2) { score.twoX += 1; console.log(`       差 2 倍以上：${food.name} 估 ${grams}g，实际 ${food.grams}g`) }
  }
  score.extra += result.data.foods.length - used.size
}

const sorted = [...latencies].sort((a, b) => a - b)
const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
console.log('---')
console.log(`调用 ${files.length} 次，失败 ${failures} 次；延迟 p50=${pick(0.5)}ms p95=${pick(0.95)}ms`)
if (failures === files.length && files.length > 0) {
  console.log(firstHttp === 400
    ? '结论：全部返回 400，这个模型很可能不支持图片输入。换一个支持图片的 OPENAI_CHAT_MODEL 再试。'
    : '结论：全部失败，先看上面的错误原因（密钥、网络、限流）。')
  process.exitCode = 1
}
if (score.labelled > 0) {
  const mean = score.absPct.length ? score.absPct.reduce((a, b) => a + b, 0) / score.absPct.length : NaN
  console.log(`有标注 ${score.labelled} 张：食物 ${score.foods} 样，认出 ${score.found}（${Math.round((score.found / score.foods) * 100)}%），多认 ${score.extra} 样`)
  console.log(`有克数可比 ${score.weighed} 样：平均误差 ${Math.round(mean * 100)}%，25% 以内 ${score.within25}，差 2 倍以上 ${score.twoX}`)
}
