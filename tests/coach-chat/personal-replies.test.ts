import { describe, expect, it } from 'vitest'
import { normalizePlan, PLAN_JSON_SCHEMA, REPLY_MAX_CHARS } from '../../lib/coach-chat/schemas'
import { buildPlannerInput, COACH_CHAT_SYSTEM_PROMPT } from '../../lib/coach-chat/prompt'
import { weightTrend, type UserContext } from '../../lib/coach-chat/user-context'
import { rawPlan, rawTask } from './helpers'

const context: UserContext = {
  goal: 'lose_fat',
  has_calorie_target: true,
  weekly_workout_target: 4,
  today_meals: [{ meal: '午餐', foods: ['牛肉面'] }],
  today_workouts: [],
  workout_days_last_7: 3,
  weight_trend_14d: 'flat',
}

describe('follow-up suggestions', () => {
  it('keeps up to three clean, distinct suggestions', () => {
    const plan = normalizePlan(rawPlan([rawTask('fitness_question')], {
      reply: '能吃。',
      follow_ups: ['晚饭吃什么比较好？', '晚饭吃什么比较好？', '一天吃 3 顿可以吗', '状态是 within_reference', '练完要吃东西吗？', '休息日吃什么？'],
    }))
    expect(plan.followUps).toEqual(['晚饭吃什么比较好？', '练完要吃东西吗？', '休息日吃什么？'])
    expect(plan.issues).toContain('dropped_follow_up')
  })

  it('treats a plan without follow_ups (older fixtures) as none', () => {
    expect(normalizePlan(rawPlan([rawTask('smalltalk')])).followUps).toEqual([])
  })

  it('is required in the strict JSON schema', () => {
    expect(PLAN_JSON_SCHEMA.required).toContain('follow_ups')
    expect(PLAN_JSON_SCHEMA.properties.follow_ups.maxItems).toBe(3)
  })
})

describe('richer replies', () => {
  it('accepts a multi-sentence answer up to the new limit, still without digits', () => {
    const long = '不完全是。长不长肉主要看一整天吃了多少，几点吃影响不大；不过吃得太晚容易越吃越多。你最近两周体重比较平，想往下走的话，晚饭可以七分饱，睡前两三个小时别再加餐。'
    expect(long.length).toBeGreaterThan(60)
    expect(long.length).toBeLessThanOrEqual(REPLY_MAX_CHARS)
    expect(normalizePlan(rawPlan([rawTask('fitness_question')], { reply: long })).reply).toBe(long)
    expect(normalizePlan(rawPlan([rawTask('fitness_question')], { reply: `${long}一般 3 小时` })).reply).toBeNull()
  })

  it('tells the model to use the context and to suggest follow-ups', () => {
    expect(COACH_CHAT_SYSTEM_PROMPT).toContain('user_context')
    expect(COACH_CHAT_SYSTEM_PROMPT).toContain('follow_ups')
  })
})

describe('user context in the planner input', () => {
  const base = { today: '2026-11-20', weekday: '周五', localHour: 20, timeZone: 'Asia/Shanghai', openDrafts: [], userMessage: '晚饭吃得晚会胖吗' }

  it('passes the summary through and sends null when it is unavailable', () => {
    const recent = Array.from({ length: 14 }, (_, i) => ({ role: 'user' as const, text: `消息${i}` }))
    const withContext = JSON.parse(buildPlannerInput({ ...base, recentMessages: recent, userContext: context }))
    expect(withContext.user_context).toEqual(context)
    expect(withContext.recent_messages).toHaveLength(10)
    expect(JSON.parse(buildPlannerInput({ ...base, recentMessages: [] })).user_context).toBeNull()
  })

  it('carries no age, sex, height, raw weight or calorie numbers', () => {
    const keys = Object.keys(context)
    for (const banned of ['age', 'birth_year', 'gender', 'sex', 'height_cm', 'weight_kg', 'daily_calorie_target']) {
      expect(keys).not.toContain(banned)
    }
  })
})

describe('weightTrend', () => {
  const points = (kgs: number[]) => kgs.map((kg, i) => ({ date: `2026-11-${String(i * 2 + 1).padStart(2, '0')}`, kg }))
  it('needs enough weigh-ins spread over enough days', () => {
    expect(weightTrend([])).toBe('unknown')
    expect(weightTrend(points([70, 69.5]))).toBe('unknown')
    expect(weightTrend([{ date: '2026-11-01', kg: 70 }, { date: '2026-11-02', kg: 69 }, { date: '2026-11-03', kg: 68 }])).toBe('unknown')
  })
  it('reads direction from older vs newer half', () => {
    expect(weightTrend(points([71, 70.8, 70.4, 70.1, 69.9, 69.7]))).toBe('down')
    expect(weightTrend(points([69, 69.3, 69.6, 70]))).toBe('up')
    expect(weightTrend(points([70, 70.2, 69.9, 70.1]))).toBe('flat')
  })
})
