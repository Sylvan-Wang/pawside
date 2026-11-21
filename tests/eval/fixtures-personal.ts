import type { NormalizedPlan } from '../../lib/coach-chat/schemas'
import type { UserContext } from '../../lib/coach-chat/user-context'
import { rawPlan, rawTask } from '../coach-chat/helpers'
import type { EvalCase } from './fixtures'

/**
 * v3.4: advice replies should be fuller (2–4 sentences), use what we know about the user,
 * and offer tappable follow-ups. Feedback 2026-11-20: "回答太简约了… 像 personal agent 那样".
 */

const CUTTING: UserContext = {
  goal: 'lose_fat',
  has_calorie_target: true,
  weekly_workout_target: 4,
  today_meals: [{ meal: '午餐', foods: ['牛肉面'] }],
  today_workouts: [],
  workout_days_last_7: 3,
  weight_trend_14d: 'flat',
}

const wrong = (cond: boolean, message: string) => (cond ? [] : [message])
const noRecord = (p: NormalizedPlan) =>
  wrong(!p.tasks.some((t) => ['log_meal', 'edit_meal', 'log_workout', 'log_weight'].includes(t.kind)), 'recorded something')

/** A rich, personal answer: a real reply, long enough to explain, and at least one follow-up. */
const personal = (mention: RegExp) => (p: NormalizedPlan) => [
  ...noRecord(p),
  ...wrong(p.reply !== null && p.reply.length >= 40, `reply too short or dropped: ${p.reply}`),
  ...wrong(p.reply !== null && mention.test(p.reply), `reply does not use the user's context: ${p.reply}`),
  ...wrong(p.followUps.length >= 1, 'no follow-up suggestions'),
]

export const CASES_PERSONAL: EvalCase[] = [
  {
    id: 'personal-late-dinner', group: 'personal', say: '我感觉晚上晚饭吃得晚就会变胖', hour: 21, userContext: CUTTING,
    gold: rawPlan([rawTask('fitness_question')], {
      reply: '不完全是。长不长肉主要看一整天吃了多少，几点吃影响不大；不过吃得太晚容易越吃越多。你最近两周体重比较平，想往下走的话，晚饭可以七分饱，睡前两三个小时别再加餐。',
      follow_ups: ['晚饭几点吃比较好？', '晚上饿了能吃什么？'],
    }),
    check: personal(/减脂|体重|平|往下/),
  },
  {
    id: 'personal-noodles', group: 'personal', say: '减脂期晚上还能吃面吗', hour: 18, userContext: CUTTING,
    gold: rawPlan([rawTask('fitness_question')], {
      reply: '能吃。减脂看的是一整天吃了多少。你中午已经吃了牛肉面，晚饭可以少一点主食，多补一掌心的鱼、蛋或豆腐，再来一大份蔬菜。',
      follow_ups: ['晚饭吃什么比较好？'],
    }),
    check: personal(/牛肉面|中午|午饭|午餐/),
  },
  {
    id: 'personal-milk-tea', group: 'personal', say: '想喝牛乳茶', hour: 15, userContext: CUTTING,
    gold: rawPlan([rawTask('consult_food', { topic: '牛乳茶' })], {
      reply: '可以喝。牛乳茶的负担主要在糖和奶精，你在减脂期，选小杯、无糖或少糖，就当下午的加餐，晚饭主食少一点就好。',
      follow_ups: ['哪种奶茶负担小一点？', '今天还能吃多少？'],
    }),
    check: personal(/减脂|加餐|晚饭|今天/),
  },
  {
    id: 'personal-no-context', group: 'personal', say: '练完要不要马上吃东西', hour: 20, userContext: null,
    gold: rawPlan([rawTask('fitness_question')], {
      reply: '不用掐着时间马上吃，一天里吃够蛋白质更要紧。如果离下一顿还远、又觉得饿，练完来一杯牛奶或一个鸡蛋加一片面包就很好。',
      follow_ups: ['一天要吃多少蛋白质？'],
    }),
    check: (p) => [
      ...noRecord(p),
      ...wrong(p.reply !== null && p.reply.length >= 30, `reply too short or dropped: ${p.reply}`),
      ...wrong(p.reply === null || !/你在减脂|你在增肌|你这周/.test(p.reply), `invented context: ${p.reply}`),
    ],
  },
]
