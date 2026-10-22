// A rule-based stand-in for the OpenAI Responses endpoint, ONLY to drive the app's UI in a browser
// when there is no API key. It reads a handful of fixed phrasings. It proves nothing about how a
// real model understands people - that is what `npm run coach:eval` is for.
import http from 'node:http'

const port = Number(process.env.FAKE_OPENAI_PORT ?? 54340)

const NUMBERS = { 半: 0.5, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 }
const number = (text) => (/^\d+(\.\d+)?$/.test(text) ? Number(text) : NUMBERS[text] ?? null)

function task(kind, fields = {}) {
  return {
    kind, draft_ref: null, date_ref: 'unspecified', explicit_date: null, meal_type: null, items: [], edits: [],
    workout_type: null, workout_minutes: null, workout_calories: null, workout_notes: null,
    weight_value: null, weight_unit: null, query_aspects: [], topic: null, boundary: null, source_quote: '', ...fields,
  }
}

function parseItem(segment) {
  const text = segment.trim()
  const m = text.match(/^(\d+(?:\.\d+)?|[半一二两三四五])\s*(克|g|个|碗|杯|份|斤)?\s*(.+)$/)
  if (!m) return { name: text, amount_value: null, amount_unit: null, grams_estimate: null, estimate_basis: 'unknown', dish_kind: 'single' }
  const unit = m[2] ?? null
  return {
    name: m[3], amount_value: number(m[1]), amount_unit: unit, grams_estimate: null,
    estimate_basis: unit === '克' || unit === 'g' ? 'user_stated' : 'unknown', dish_kind: 'single',
  }
}

function plan(userMessage, openDrafts, recent = []) {
  const text = userMessage
  let m
  if (/^我今天(跑步|游泳)了$/.test(text)) {
    return { tasks: [], clarification: { about: 'workout', question: '大概做了多久呢？', options: ['半小时', '一小时'] } }
  }
  if (/^(半小时|一小时)$/.test(text)) {
    const previous = [...recent].reverse().find((message) => message.role === 'user' && /跑步|游泳/.test(message.text))
    const activity = previous?.text.match(/跑步|游泳/)?.[0]
    if (activity) return { tasks: [task('log_workout', { workout_type: activity, workout_minutes: text === '半小时' ? 30 : 60 })] }
  }
  if ((m = text.match(/体重\s*(\d+(?:\.\d+)?)/))) return { tasks: [task('log_weight', { weight_value: Number(m[1]) })] }
  if ((m = text.match(/(跑步|游泳|骑行|深蹲).*?(\d+)\s*分钟/))) return { tasks: [task('log_workout', { workout_type: m[1], workout_minutes: Number(m[2]) })] }
  if (/不是.+，是.+/.test(text)) {
    const [, from, to] = text.match(/不是(.+)，是(.+)/)
    return { tasks: [task('edit_meal', { draft_ref: openDrafts[0]?.id ?? null, edits: [{ action: 'replace_food', target_item: from, factor: null, grams: null, new_name: to }] })] }
  }
  if (/只吃了一半/.test(text)) return { tasks: [task('edit_meal', { edits: [{ action: 'scale_all', target_item: null, factor: 0.5, grams: null, new_name: null }] })] }
  if (/算了|不记了/.test(text)) return { tasks: [task('cancel_draft', { draft_ref: openDrafts[0]?.id ?? null })] }
  if (/吃了什么|练了什么|情况/.test(text)) return { tasks: [task('query_day', { date_ref: 'today', query_aspects: ['meals', 'nutrition', 'workouts', 'weight'] })] }
  if (/吃什么/.test(text)) return { tasks: [task('consult_food', { topic: '今天吃什么' })], reply: '想吃点清淡的还是顶饱的？' }
  if ((m = text.match(/吃了(.+)/))) {
    const items = m[1].split(/和|、|，|,/).map(parseItem)
    const meal_type = /早/.test(text) ? 'breakfast' : /中午|午/.test(text) ? 'lunch' : /晚/.test(text) ? 'dinner' : null
    return { tasks: [task('log_meal', { meal_type, items })] }
  }
  return { tasks: [task('smalltalk')], reply: '我在。' }
}

http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    const name = body.text?.format?.name
    let output
    if (name === 'pawside_coach_plan_v1') {
      const input = JSON.parse(body.input)
      const base = plan(input.user_message, input.open_drafts ?? [], input.recent_messages ?? [])
      output = { reply: null, clarification: null, ...base }
    } else if (name === 'pawside_food_estimates_v1') {
      const input = JSON.parse(body.input)
      output = { foods: input.foods.map((food) => ({ name: food, energy_kcal: 150, protein_g: 10, carb_g: 15, fat_g: 5, fiber_g: null, confidence: 0.4, caveat: '按常见做法估算' })) }
    } else {
      output = { energy_kcal: 150, protein_g: 10, carb_g: 15, fat_g: 5, fiber_g: null, confidence: 0.4, caveat: '按常见做法估算' }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ output_text: JSON.stringify(output), usage: { input_tokens: 100, output_tokens: 50 } }))
  })
}).listen(port, '127.0.0.1', () => console.log(`fake openai on ${port}`))
