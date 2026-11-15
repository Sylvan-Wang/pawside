import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  IDEA_FOODS, MEAL_IDEAS, asksForMealIdeas, ideaNutrition, mealIdeasText, pickMealIdeas, slotFor, type DayBudget,
} from '../../lib/coach-chat/meal-ideas'

function csv(path: string): Map<string, Record<string, string>> {
  // Quoted cells may hold commas («"米饭(蒸,籼米)"»).
  const split = (line: string) => [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1])
  const [header, ...rows] = readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/)
  const keys = split(header)
  return new Map(rows.map((line) => {
    const cells = split(line)
    return [cells[0], Object.fromEntries(keys.map((k, i) => [k, cells[i]]))]
  }))
}

const NO_TARGET: DayBudget = { targetKcal: null, targetProtein: null, eatenKcal: null, eatenProtein: null }
const DAY = '2026-11-15'

describe('meal ideas data', () => {
  it('has a real menu: 100+ dishes, enough for every meal', () => {
    expect(MEAL_IDEAS.length).toBeGreaterThanOrEqual(120)
    expect(MEAL_IDEAS.filter((i) => i.slot === 'main').length).toBeGreaterThanOrEqual(80)
    expect(MEAL_IDEAS.filter((i) => i.slot === 'breakfast').length).toBeGreaterThanOrEqual(15)
    expect(MEAL_IDEAS.filter((i) => i.slot === 'snack').length).toBeGreaterThanOrEqual(10)
  })

  const foods = csv('supabase/seeds/foods_clean.csv')
  const nutrition = csv('supabase/seeds/food_nutrition_clean.csv')
  for (const [id, row] of csv('supabase/seeds/foods_usda_supplement.csv')) {
    foods.set(id, row)
    nutrition.set(id, row)
  }

  it('copies every per-100g number from the food library exactly', () => {
    for (const [id, food] of Object.entries(IDEA_FOODS)) {
      expect(foods.get(id)?.canonical_name, `food ${id}`).toBe(food.name)
      expect(Number(nutrition.get(id)?.energy_kcal_100g), `kcal ${id}`).toBe(food.kcal)
      expect(Number(nutrition.get(id)?.protein_g_100g), `protein ${id}`).toBe(food.protein)
    }
  })

  it('every dish has a name, grams for each ingredient, steps, and a believable one-person total', () => {
    const codes = new Set<string>()
    for (const idea of MEAL_IDEAS) {
      expect(codes.has(idea.code)).toBe(false)
      codes.add(idea.code)
      expect(idea.ingredients.length).toBeGreaterThan(0)
      for (const item of idea.ingredients) expect(item.grams).toBeGreaterThan(0)
      expect(idea.steps.length).toBeGreaterThan(5)
      const { kcal, protein } = ideaNutrition(idea)
      const [lo, hi] = idea.slot === 'snack' ? [100, 300] : idea.slot === 'breakfast' ? [250, 550] : [300, 750]
      expect(kcal, idea.name).toBeGreaterThan(lo)
      expect(kcal, idea.name).toBeLessThan(hi)
      expect(protein, idea.name).toBeGreaterThan(idea.slot === 'snack' ? 8 : 15)
    }
  })

  it('adds up the ingredients (西兰花炒鸡胸: 150g 鸡胸 + 200g 西兰花 + 8g 油 + 150g 米饭)', () => {
    const idea = MEAL_IDEAS.find((i) => i.code === 'MI-01')!
    const { kcal, protein } = ideaNutrition(idea)
    expect(kcal).toBeCloseTo(1.5 * 133 + 2 * 33 + 0.08 * 899 + 1.5 * 114, 5)
    expect(protein).toBeCloseTo(1.5 * 19.4 + 2 * 4.1 + 1.5 * 2.5, 5)
  })
})

describe('USDA supplement', () => {
  const rows = [...csv('supabase/seeds/foods_usda_supplement.csv').values()]
  const sql = readFileSync('supabase/seeds/seed_usda_supplement.sql', 'utf8')
  it('every row names its USDA source, sits above the Chinese table ids, and is in the seed SQL', () => {
    expect(rows.length).toBeGreaterThan(10)
    for (const row of rows) {
      expect(Number(row.food_id)).toBeGreaterThan(2000)
      expect(row.fdc_id).toMatch(/^\d{6,7}$/)
      expect(sql).toContain(`fdcId ${row.fdc_id}: `)
      expect(sql).toContain(`(${row.food_id}, ${row.energy_kcal_100g}, ${row.protein_g_100g}, `)
      // Energy roughly agrees with 4/4/9 kcal per g of protein, carbohydrate and fat.
      const atwater = 4 * Number(row.protein_g_100g) + 4 * Number(row.carb_g_100g) + 9 * Number(row.fat_g_100g)
      expect(Math.abs(atwater - Number(row.energy_kcal_100g)) / Number(row.energy_kcal_100g), row.canonical_name).toBeLessThan(0.2)
    }
  })
})

describe('when to answer with dishes', () => {
  it.each(['晚上推荐个食谱', '今天吃什么好？', '减脂餐吃啥', '鸡胸肉怎么做好吃', '推荐个高蛋白的晚饭', '明天早饭吃点什么', '有虾和豆腐，晚上能做什么菜'])('%s', (text) => {
    expect(asksForMealIdeas(text)).toBe(true)
  })
  it.each(['好想喝奶茶', '减脂期可以吃水果吗', '晚上八点以后还能吃东西吗', '奶茶能喝吗', '今天吃了什么'])('not: %s', (text) => {
    expect(asksForMealIdeas(text)).toBe(false)
  })
})

describe('which meal', () => {
  it('uses the meal the user names, the last one when several', () => {
    expect(slotFor('晚上推荐个食谱', 9)).toBe('dinner')
    expect(slotFor('明天早饭吃点什么', 22)).toBe('breakfast')
    expect(slotFor('中午吃了黄焖鸡米饭，晚上吃什么', 13)).toBe('dinner')
    expect(slotFor('夜宵吃啥', 23)).toBe('snack')
  })
  it('falls back to the clock', () => {
    expect(slotFor('今天吃什么好', 11)).toBe('lunch')
    expect(slotFor('今天吃什么好', 19)).toBe('dinner')
  })
})

describe('picking', () => {
  it('gives two concrete dinners for 「晚上推荐个食谱」 with no data at all', () => {
    const pick = pickMealIdeas('晚上推荐个食谱', 18, DAY, NO_TARGET)
    expect(pick.slot).toBe('dinner')
    expect(pick.ideas).toHaveLength(2)
    for (const { idea } of pick.ideas) expect(idea.slot).toBe('main')
  })

  it('is stable for a day and rotates across days', () => {
    const a = pickMealIdeas('晚上推荐个食谱', 18, DAY, NO_TARGET).ideas.map((i) => i.idea.code)
    expect(pickMealIdeas('晚上推荐个食谱', 18, DAY, NO_TARGET).ideas.map((i) => i.idea.code)).toEqual(a)
    const days = new Set(Array.from({ length: 14 }, (_, d) =>
      pickMealIdeas('晚上推荐个食谱', 18, `2026-11-${String(d + 1).padStart(2, '0')}`, NO_TARGET).ideas.map((i) => i.idea.code).join()))
    expect(days.size).toBeGreaterThan(1)
  })

  it('a generic fish fits the fish dishes, a named other fish does not', () => {
    const pick = pickMealIdeas('晚上想吃鱼', 18, DAY, NO_TARGET)
    for (const { idea } of pick.ideas) expect(idea.keywords).toContain('鱼')
    expect(pickMealIdeas('龙利鱼怎么做', 18, DAY, NO_TARGET).topicMissed).toBe(true)
    const named = pickMealIdeas('带鱼怎么做', 18, DAY, NO_TARGET)
    for (const { idea } of named.ideas) expect(idea.keywords).toContain('带鱼')
  })

  it('follows the ingredient the user names', () => {
    const pick = pickMealIdeas('鸡胸肉怎么做好吃', 18, DAY, NO_TARGET)
    for (const { idea } of pick.ideas) expect(idea.ingredients.some((i) => i.label === '鸡胸肉')).toBe(true)
    expect(pick.topicMissed).toBe(false)
  })

  it('says so when the named food is not in the list, instead of pretending', () => {
    const pick = pickMealIdeas('比目鱼怎么做', 18, DAY, NO_TARGET)
    expect(pick.topicMissed).toBe(true)
    expect(mealIdeasText(pick)).toContain('还没有现成的做法')
  })

  it('does not read 「蛋白」 as eggs, and leans to protein when asked', () => {
    const pick = pickMealIdeas('推荐个高蛋白的晚饭', 18, DAY, NO_TARGET)
    expect(pick.lean).toBe('protein')
    expect(pick.topicMissed).toBe(false)
    for (const { nutrition } of pick.ideas) expect(nutrition.protein).toBeGreaterThan(30)
  })

  it('fits what is left of today: a small budget gets the lighter dishes', () => {
    const tight = pickMealIdeas('晚上推荐个食谱', 18, DAY, { targetKcal: 1600, targetProtein: 100, eatenKcal: 1150, eatenProtein: 60 })
    expect(tight.remainingKcal).toBe(450)
    expect(tight.remainingProtein).toBe(40)
    for (const { nutrition } of tight.ideas) expect(nutrition.kcal).toBeLessThan(450 * 1.2)
    const text = mealIdeasText(tight)
    expect(text).toContain('还能吃约 450 kcal')
    expect(text).toContain('蛋白质还差约 40 g')
  })

  it('uses a share of the target when today is unknown', () => {
    const pick = pickMealIdeas('今天吃什么好', 12, DAY, { targetKcal: 2000, targetProtein: 120, eatenKcal: null, eatenProtein: null })
    expect(pick.slot).toBe('lunch')
    expect(pick.mealKcal).toBe(700)
    expect(mealIdeasText(pick)).toContain('这一餐大约 700 kcal')
  })
})

describe('text', () => {
  it('names each dish with ingredients in grams, calories and protein', () => {
    const text = mealIdeasText(pickMealIdeas('晚上推荐个食谱', 18, DAY, NO_TARGET))
    expect(text).toMatch(/① .+\n约 \d+ kcal · 蛋白质 \d+ g\n食材：.+\d+g/)
    expect(text).toMatch(/② /)
    expect(text).toContain('做法：')
    expect(text).not.toMatch(/清淡的家常晚餐/)
  })
})

describe('variety', () => {
  it('a vague 「做什么菜」 is not treated as a food we lack', () => {
    expect(pickMealIdeas('晚上做什么菜', 18, DAY, NO_TARGET).topicMissed).toBe(false)
    expect(pickMealIdeas('推荐个食谱', 12, DAY, NO_TARGET).topicMissed).toBe(false)
  })
  it('over two weeks of 「晚上推荐个食谱」 shows many different dinners', () => {
    const seen = new Set<string>()
    for (let d = 1; d <= 14; d++) {
      for (const { idea } of pickMealIdeas('晚上推荐个食谱', 18, `2026-11-${String(d).padStart(2, '0')}`, NO_TARGET).ideas) seen.add(idea.code)
    }
    expect(seen.size).toBeGreaterThanOrEqual(15)
  })
})

describe('foods from the USDA supplement', () => {
  it('「三文鱼怎么做」 now gets salmon dishes', () => {
    const pick = pickMealIdeas('三文鱼怎么做', 18, DAY, NO_TARGET)
    expect(pick.topicMissed).toBe(false)
    for (const { idea } of pick.ideas) expect(idea.ingredients.some((i) => i.food === 2001)).toBe(true)
  })
})
