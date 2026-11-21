import type { NormalizedPlan, PlanTask } from '../../lib/coach-chat/schemas'
import { asksForMealIdeas } from '../../lib/coach-chat/meal-ideas'
import { rawItem, rawPlan, rawTask } from '../coach-chat/helpers'
import type { EvalCase } from './fixtures'

/**
 * 「推荐个食谱 / 吃什么」(2026-11-15, live): 「晚上推荐个食谱」 got one generic sentence
 * («可以试试清淡的家常晚餐…»), with no dish, no ingredients, no calories or protein.
 *
 * The concrete answer is built by the server (meal-ideas.ts), so what the MODEL must get right is
 * only the routing: these sentences are consult_food (fitness_question is tolerated, the server
 * reroutes it), never a record, and the reply has no numbers (the model may not invent a recipe).
 * Every `say` here must also be recognised by asksForMealIdeas, so the server attaches dishes.
 */

type Of<K extends PlanTask['kind']> = Extract<PlanTask, { kind: K }>
const kinds = (p: NormalizedPlan) => p.tasks.map((t) => t.kind)
const one = <K extends PlanTask['kind']>(p: NormalizedPlan, k: K): Of<K> | null => {
  const f = p.tasks.filter((t): t is Of<K> => t.kind === k)
  return f.length === 1 ? f[0] : null
}
const wrong = (cond: boolean, msg: string) => (cond ? [] : [msg])
const records = (p: NormalizedPlan) => kinds(p).filter((k) => k.startsWith('log_') || k === 'edit_meal' || k === 'confirm_draft')

let n = 0
function recipeAsk(say: string, o: { hour?: number; topic?: string } = {}): EvalCase {
  return {
    id: `recipe-${String(++n).padStart(2, '0')}`, group: 'recipe', say, hour: o.hour ?? 18,
    gold: rawPlan([rawTask('consult_food', { topic: o.topic ?? null })], { reply: '晚饭配一份鱼虾或瘦肉，加蔬菜和主食就很好。' }),
    check: (p) => {
      const consult = one(p, 'consult_food')
      return [
        ...wrong(!!consult || kinds(p).includes('fitness_question'), `expected consult_food, got [${kinds(p)}]`),
        ...wrong(records(p).length === 0, `created a record: [${kinds(p)}]`),
        ...wrong(!p.reply || !/\d/.test(p.reply), `numbers in reply: ${p.reply}`),
        ...wrong(asksForMealIdeas(say), `server would not attach dishes for: ${say}`),
        ...(o.topic && consult ? wrong(!!consult.topic?.includes(o.topic), `topic ${consult.topic}, expected ${o.topic}`) : []),
      ]
    },
  }
}

export const CASES_RECIPES: EvalCase[] = [
  recipeAsk('晚上推荐个食谱'),
  recipeAsk('今天吃什么好？', { hour: 11 }),
  recipeAsk('推荐个高蛋白的晚饭'),
  recipeAsk('减脂餐吃啥', { hour: 12 }),
  recipeAsk('鸡胸肉怎么做好吃', { topic: '鸡胸' }),
  recipeAsk('明天早饭吃点什么', { hour: 22 }),
  recipeAsk('练完了饿了，晚上做点什么吃', { hour: 20 }),
  recipeAsk('有虾和豆腐，晚上能做什么菜', { hour: 17, topic: '虾' }),
  {
    id: 'recipe-after-meal', group: 'recipe', say: '中午吃了黄焖鸡米饭，晚上吃什么', hour: 13,
    gold: rawPlan([
      rawTask('log_meal', { meal_type: 'lunch', items: [rawItem('黄焖鸡米饭', { amount_value: 1, amount_unit: '份', grams_estimate: 450, estimate_basis: 'model_estimate', dish_kind: 'mixed_dish' })] }),
      rawTask('consult_food'),
    ], { reply: '晚饭清爽一点，配鱼虾或豆腐。' }),
    check: (p) => [
      ...wrong(!!one(p, 'log_meal') && !!one(p, 'consult_food'), `expected log_meal + consult_food, got [${kinds(p)}]`),
      ...wrong(!p.reply || !/\d/.test(p.reply), `numbers in reply: ${p.reply}`),
    ],
  },
]
