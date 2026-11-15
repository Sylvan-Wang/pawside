import { inferMealSlot, type MealSlot } from './dates'
import { IDEA_FOODS } from './meal-ideas-foods'
import { MORE_IDEAS } from './meal-ideas-more'

/**
 * 「吃什么 / 推荐个食谱」的具体回答：小爪自己的一人份家常菜（菜名、食材克数、做法一句话），
 * 热量和蛋白质由代码按爪边食物库（supabase/seeds/food_nutrition_clean.csv，每 100 g）
 * 算出来，再按用户今天的目标和已记录的摄入挑最合适的两道。
 *
 * 和 recipes.ts（B 站视频指针）一样，模型不参与：它不挑菜、不写食材、不写数字。
 * 这里的菜谱是我们自己写的、能核对的数据，所以可以给出数字；每个数字都能从
 * IDEA_FOODS（meal-ideas-foods.ts，由脚本从食物库生成）的每 100 g 数值和克数复算（tests/coach-chat/meal-ideas.test.ts 会对照 CSV 校验）。
 * 推荐不会写进用户的饮食记录：用户吃了以后自己说「晚饭吃了 X」，走正常的草稿确认。
 */

export { IDEA_FOODS } from './meal-ideas-foods'

export type IdeaFoodId = keyof typeof IDEA_FOODS

export interface IdeaIngredient {
  /** 给用户看的名字（「鸡胸肉」，不是表里的「鸡胸脯肉」）。 */
  label: string
  food: IdeaFoodId
  grams: number
  /** 克数的口径，比如「生」「熟」「干」，让用户知道该怎么称。 */
  note?: string
}

export type IdeaSlot = 'breakfast' | 'main' | 'snack'

export interface MealIdea {
  code: string
  name: string
  slot: IdeaSlot
  /** 用户提到这些词时优先推荐这道（「鸡胸肉怎么做」→ 鸡胸）。 */
  keywords: string[]
  ingredients: IdeaIngredient[]
  steps: string
}

const OIL = (grams: number): IdeaIngredient => ({ label: '油', food: 1016, grams })
const RICE = (grams: number): IdeaIngredient => ({ label: '米饭', food: 821, grams, note: '熟' })

const FIRST_IDEAS: MealIdea[] = [
  // --- 午饭 / 晚饭 ---------------------------------------------------------------------
  {
    code: 'MI-01', name: '西兰花炒鸡胸 + 米饭', slot: 'main', keywords: ['鸡胸', '鸡肉', '西兰花'],
    ingredients: [{ label: '鸡胸肉', food: 1581, grams: 150, note: '生' }, { label: '西兰花', food: 1234, grams: 200 }, OIL(8), RICE(150)],
    steps: '鸡胸切片用少许生抽和淀粉抓匀，热锅少油滑熟盛出；西兰花焯水后回锅一起炒，盐调味。',
  },
  {
    code: 'MI-02', name: '番茄虾仁炒蛋 + 米饭', slot: 'main', keywords: ['虾', '番茄', '西红柿', '鸡蛋', '炒蛋'],
    ingredients: [{ label: '鲜虾仁', food: 207, grams: 100 }, { label: '鸡蛋', food: 1584, grams: 100, note: '约 2 个' }, { label: '番茄', food: 733, grams: 200 }, OIL(8), RICE(150)],
    steps: '鸡蛋炒到半熟盛出；番茄炒出汁，下虾仁炒到变色，倒回鸡蛋翻匀，盐调味。',
  },
  {
    code: 'MI-03', name: '清蒸鲈鱼 + 蒜蓉菠菜 + 米饭', slot: 'main', keywords: ['鲈鱼', '鱼', '清蒸', '菠菜'],
    ingredients: [{ label: '鲈鱼肉', food: 1516, grams: 200, note: '去骨' }, { label: '菠菜', food: 1116, grams: 200 }, OIL(6), RICE(150)],
    steps: '鲈鱼铺姜葱大火蒸 8 分钟，倒掉蒸出的水，淋蒸鱼豉油和一点热油；菠菜焯水后蒜蓉快炒。',
  },
  {
    code: 'MI-04', name: '洋葱炒牛肉 + 米饭', slot: 'main', keywords: ['牛肉', '洋葱'],
    ingredients: [{ label: '瘦牛肉', food: 608, grams: 150, note: '生' }, { label: '洋葱', food: 515, grams: 100 }, { label: '胡萝卜', food: 958, grams: 50 }, OIL(8), RICE(150)],
    steps: '牛肉逆纹切片，用生抽、淀粉抓匀；大火快炒到变色盛出，再炒洋葱胡萝卜，回锅翻匀。',
  },
  {
    code: 'MI-05', name: '番茄炖牛肉土豆', slot: 'main', keywords: ['牛肉', '番茄', '西红柿', '土豆', '炖'],
    ingredients: [{ label: '牛后腿肉', food: 607, grams: 150, note: '生' }, { label: '番茄', food: 733, grams: 200 }, { label: '土豆', food: 129, grams: 200 }, OIL(6)],
    steps: '牛肉切块焯水；番茄炒出汁，加牛肉和热水小火炖 1 小时，放土豆再炖 20 分钟。土豆当主食，不用另吃米饭。',
  },
  {
    code: 'MI-06', name: '虾仁豆腐小白菜汤 + 红薯', slot: 'main', keywords: ['豆腐', '虾', '汤', '红薯'],
    ingredients: [{ label: '鲜虾仁', food: 207, grams: 100 }, { label: '豆腐', food: 1258, grams: 200 }, { label: '小白菜', food: 209, grams: 150 }, OIL(3), { label: '红薯', food: 865, grams: 150, note: '蒸' }],
    steps: '豆腐切块煮 3 分钟，下虾仁和小白菜煮熟，盐和白胡椒调味；红薯另外蒸熟。',
  },
  {
    code: 'MI-07', name: '鸡胸肉菠菜鸡蛋面', slot: 'main', keywords: ['面', '鸡胸', '鸡肉', '鸡蛋'],
    ingredients: [{ label: '挂面', food: 1437, grams: 80, note: '干' }, { label: '鸡胸肉', food: 1581, grams: 120, note: '生' }, { label: '鸡蛋', food: 1584, grams: 50, note: '1 个' }, { label: '菠菜', food: 1116, grams: 100 }, OIL(3)],
    steps: '鸡胸切丝先煮熟，下面条，快好时打入鸡蛋、放菠菜，生抽和几滴油调味。',
  },
  {
    code: 'MI-08', name: '卷心菜炒肉片 + 米饭', slot: 'main', keywords: ['猪肉', '肉片', '卷心菜', '包菜'],
    ingredients: [{ label: '猪里脊', food: 653, grams: 120, note: '生，瘦肉' }, { label: '卷心菜', food: 95, grams: 200 }, OIL(8), RICE(150)],
    steps: '肉片用生抽淀粉抓匀炒散盛出；卷心菜手撕，大火炒软，回锅肉片，醋和盐调味。',
  },
  {
    code: 'MI-09', name: '鳕鱼豆腐金针菇煲 + 米饭', slot: 'main', keywords: ['鳕鱼', '鱼', '豆腐', '金针菇'],
    ingredients: [{ label: '鳕鱼', food: 1555, grams: 150 }, { label: '豆腐', food: 1258, grams: 150 }, { label: '金针菇', food: 1379, grams: 100 }, OIL(5), RICE(120)],
    steps: '姜片煸香加水，放豆腐和金针菇煮开，铺鳕鱼块小火煮 6 分钟，生抽盐调味。',
  },
  {
    code: 'MI-10', name: '毛豆虾仁炒蛋 + 米饭', slot: 'main', keywords: ['毛豆', '虾', '鸡蛋', '炒蛋'],
    ingredients: [{ label: '毛豆', food: 461, grams: 80 }, { label: '鲜虾仁', food: 207, grams: 100 }, { label: '鸡蛋', food: 1584, grams: 50, note: '1 个' }, OIL(8), RICE(150)],
    steps: '毛豆焯熟；鸡蛋炒散盛出，再炒虾仁到变色，加毛豆和鸡蛋翻匀，盐调味。',
  },
  {
    code: 'MI-11', name: '凉拌鸡丝黄瓜 + 玉米', slot: 'main', keywords: ['鸡胸', '鸡肉', '鸡丝', '凉拌', '黄瓜', '玉米'],
    ingredients: [{ label: '鸡胸肉', food: 1581, grams: 150, note: '生' }, { label: '黄瓜', food: 1657, grams: 150 }, { label: '胡萝卜', food: 958, grams: 50 }, OIL(5), { label: '鲜玉米', food: 687, grams: 200, note: '1 根' }],
    steps: '鸡胸冷水下锅煮 15 分钟，撕丝；黄瓜胡萝卜切丝，加醋、生抽、蒜末和几滴热油拌匀；玉米蒸熟。',
  },
  {
    code: 'MI-12', name: '香菇西葫芦炒蛋 + 馒头', slot: 'main', keywords: ['鸡蛋', '炒蛋', '西葫芦', '香菇', '素', '馒头'],
    ingredients: [{ label: '鸡蛋', food: 1584, grams: 100, note: '约 2 个' }, { label: '西葫芦', food: 1245, grams: 200 }, { label: '鲜香菇', food: 1478, grams: 80 }, OIL(8), { label: '馒头', food: 1468, grams: 100, note: '1 个' }],
    steps: '鸡蛋炒散盛出；香菇西葫芦切片炒软，倒回鸡蛋，盐调味。',
  },
  // --- 早饭 ---------------------------------------------------------------------------
  {
    code: 'MI-21', name: '酸奶燕麦 + 水煮蛋', slot: 'breakfast', keywords: ['燕麦', '酸奶', '鸡蛋'],
    ingredients: [{ label: '燕麦片', food: 577, grams: 40, note: '干' }, { label: '酸奶', food: 1348, grams: 200 }, { label: '鸡蛋', food: 1584, grams: 100, note: '2 个' }],
    steps: '燕麦泡进酸奶里（前一晚泡好更方便）；鸡蛋冷水下锅煮 8 分钟。',
  },
  {
    code: 'MI-22', name: '豆浆 + 鸡蛋 + 馒头', slot: 'breakfast', keywords: ['豆浆', '鸡蛋', '馒头'],
    ingredients: [{ label: '无糖豆浆', food: 1252, grams: 300 }, { label: '鸡蛋', food: 1584, grams: 100, note: '2 个' }, { label: '馒头', food: 1468, grams: 80 }],
    steps: '豆浆选无糖的；鸡蛋水煮或蒸；馒头蒸热。',
  },
  {
    code: 'MI-23', name: '小米粥 + 鸡蛋 + 拍黄瓜', slot: 'breakfast', keywords: ['粥', '小米', '鸡蛋', '黄瓜'],
    ingredients: [{ label: '小米粥', food: 211, grams: 300 }, { label: '鸡蛋', food: 1584, grams: 100, note: '2 个' }, { label: '黄瓜', food: 1657, grams: 150 }],
    steps: '小米粥煮稠一点；鸡蛋水煮；黄瓜拍碎，醋和蒜末拌一下。',
  },
  // --- 加餐 ---------------------------------------------------------------------------
  {
    code: 'MI-31', name: '酸奶 + 水煮蛋', slot: 'snack', keywords: ['酸奶', '鸡蛋', '加餐'],
    ingredients: [{ label: '酸奶', food: 1348, grams: 150 }, { label: '鸡蛋', food: 1584, grams: 50, note: '1 个' }],
    steps: '酸奶选无糖或低糖的。',
  },
  {
    code: 'MI-32', name: '盐水毛豆', slot: 'snack', keywords: ['毛豆', '加餐'],
    ingredients: [{ label: '毛豆', food: 461, grams: 150, note: '剥好的豆' }],
    steps: '带壳毛豆加盐和八角煮 10 分钟，放凉吃。',
  },
]

/** 全部菜谱：第一批 + meal-ideas-more.ts 的第二批。 */
export const MEAL_IDEAS: MealIdea[] = [...FIRST_IDEAS, ...MORE_IDEAS]

export interface IdeaNutrition {
  kcal: number
  protein: number
}

/** 未取整的合计；取整只在显示时做。 */
export function ideaNutrition(idea: MealIdea): IdeaNutrition {
  let kcal = 0
  let protein = 0
  for (const item of idea.ingredients) {
    const food = IDEA_FOODS[item.food]
    kcal += (food.kcal * item.grams) / 100
    protein += (food.protein * item.grams) / 100
  }
  return { kcal, protein }
}

// ---------------------------------------------------------------------------
// 什么时候给出菜谱
// ---------------------------------------------------------------------------

/** 用户在要一个推荐 / 做法，而不是问「能不能吃」。 */
const ASKS_FOR_IDEAS = /(推荐|食谱|菜谱|做法|怎么做|怎么吃|做什么|做点|吃什么|吃啥|吃点啥|吃点什么|有啥吃|有什么吃|有什么好吃|有什么可以吃|该吃|搭配|配餐|带饭|便当|减脂餐|增肌餐|健身餐)/

export function asksForMealIdeas(text: string): boolean {
  return ASKS_FOR_IDEAS.test(text.normalize('NFKC'))
}

const SLOT_WORDS: Array<[RegExp, MealSlot]> = [
  [/(夜宵|宵夜|加餐|零食|下午茶|嘴馋)/, 'snack'],
  [/(早饭|早餐|早上|早晨|明早|今早)/, 'breakfast'],
  [/(午饭|午餐|中午|带饭|便当)/, 'lunch'],
  [/(晚饭|晚餐|晚上|今晚|明晚)/, 'dinner'],
]

/**
 * 用户说了哪一餐就用哪一餐，否则按当地时间推测（同 inferMealSlot）。说了好几餐时取最后
 * 提到的那一餐：「中午吃了米饭，晚上吃什么」问的是晚饭。
 */
export function slotFor(text: string, hour: number): MealSlot {
  let best: { at: number; slot: MealSlot } | null = null
  for (const [pattern, slot] of SLOT_WORDS) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      if (!best || match.index > best.at) best = { at: match.index, slot }
    }
  }
  return best ? best.slot : inferMealSlot(hour)
}

function ideaSlot(slot: MealSlot): IdeaSlot {
  return slot === 'breakfast' ? 'breakfast' : slot === 'snack' ? 'snack' : 'main'
}

/** 一餐在一天里大致占多少（只在不知道今天剩多少时用来分配目标）。 */
const SHARE: Record<MealSlot, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 }

// ---------------------------------------------------------------------------
// 挑哪两道
// ---------------------------------------------------------------------------

export interface DayBudget {
  targetKcal: number | null
  targetProtein: number | null
  /** 今天已记录的合计；只有每一项热量都已知时才不为 null（与 day-facts 的 complete 一致）。 */
  eatenKcal: number | null
  eatenProtein: number | null
}

export interface MealIdeaPick {
  slot: MealSlot
  ideas: Array<{ idea: MealIdea; nutrition: IdeaNutrition }>
  /** 这一餐大约该吃多少；没有目标时为 null。 */
  mealKcal: number | null
  mealProtein: number | null
  /** 今天还剩多少（只有记录完整且有目标时）。 */
  remainingKcal: number | null
  remainingProtein: number | null
  /** 用户点名的食材我们没有对应的菜。 */
  topicMissed: boolean
  lean: 'protein' | 'light' | null
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function keywordHits(idea: MealIdea, text: string): number {
  // 「蛋白质」「高蛋白」里的「蛋」不是鸡蛋。
  const cleaned = text.replace(/蛋白/g, '')
  return idea.keywords.filter((word) => (word === '鱼' ? mentionsAnyFish(cleaned) : cleaned.includes(word))).length
}

/**
 * 「想吃鱼」「晚上做条鱼」是泛指，鲈鱼、鳕鱼都合适；「三文鱼」「带鱼」是点名了别的鱼，
 * 不能拿鲈鱼冒充。
 */
function mentionsAnyFish(text: string): boolean {
  let rest = text
  for (const name of knownFish()) rest = rest.split(name).join('')
  return /(^|[^\p{Script=Han}]|[吃想条的点些蒸煮做买有块])鱼/u.test(rest)
}

let fishNames: string[] | null = null
/** 清单里点名的鱼（「带鱼」「鲈鱼」…），由各道菜的关键词得出。 */
function knownFish(): string[] {
  fishNames ??= [...new Set(MEAL_IDEAS.flatMap((idea) => idea.keywords).filter((w) => w.length > 1 && w.endsWith('鱼')))]
  return fishNames
}

export const IDEA_LIMIT = 2

/**
 * 纯函数：按（点名的食材 → 这一餐的热量预算 → 蛋白质）排序，同一天同一问题结果稳定、隔天轮换。
 * 有预算时，超出预算 15% 以上的菜排到后面；没有目标时按蛋白质密度挑。
 */
export function pickMealIdeas(text: string, hour: number, today: string, budget: DayBudget, limit = IDEA_LIMIT): MealIdeaPick {
  const normalized = text.normalize('NFKC')
  const slot = slotFor(normalized, hour)
  const pool = MEAL_IDEAS.filter((idea) => idea.slot === ideaSlot(slot))
  const lean: MealIdeaPick['lean'] = /(高蛋白|蛋白质|增肌|练完|练后)/.test(normalized)
    ? 'protein'
    : /(减脂|低卡|清淡|少油|热量低|不胖|轻食)/.test(normalized) ? 'light' : null

  const remainingKcal = budget.targetKcal !== null && budget.eatenKcal !== null ? budget.targetKcal - budget.eatenKcal : null
  const remainingProtein = budget.targetProtein !== null && budget.eatenProtein !== null ? budget.targetProtein - budget.eatenProtein : null

  let mealKcal: number | null = null
  if (remainingKcal !== null) {
    // 晚饭/加餐就是今天剩下的；早饭午饭后面还有饭，只拿一部分。
    const left = Math.max(remainingKcal, 0)
    mealKcal = slot === 'dinner' ? left : slot === 'snack' ? Math.min(left, 300) : slot === 'lunch' ? left * 0.5 : left * 0.35
  } else if (budget.targetKcal !== null) {
    mealKcal = budget.targetKcal * SHARE[slot]
  }
  let mealProtein: number | null = null
  if (remainingProtein !== null) {
    const left = Math.max(remainingProtein, 0)
    mealProtein = slot === 'dinner' || slot === 'snack' ? left : slot === 'lunch' ? left * 0.5 : left * 0.35
  } else if (budget.targetProtein !== null) {
    mealProtein = budget.targetProtein * SHARE[slot]
  }

  const scored = pool.map((idea) => {
    const nutrition = ideaNutrition(idea)
    const over = mealKcal !== null && mealKcal > 0 ? Math.max(0, nutrition.kcal / mealKcal - 1.15) : 0
    const density = nutrition.protein / Math.max(nutrition.kcal, 1) // g / kcal
    let score = density * 100 // ~4–15
    if (lean === 'protein') score += nutrition.protein / 5
    if (lean === 'light') score -= nutrition.kcal / 100
    if (mealProtein !== null) score -= Math.max(0, mealProtein - nutrition.protein) / 10
    score -= over * 20
    return { idea, nutrition, hits: keywordHits(idea, normalized), score }
  })

  // 离最好的一道差 3 分以内都算「够好」，够好的之间按日期轮换，免得每天都是同一道。
  const best = Math.max(...scored.map((entry) => entry.score))
  const tier = (score: number) => (score >= best - 3 ? 0 : 1 + Math.floor((best - score) / 3))
  const anyHit = scored.some((entry) => entry.hits > 0)
  // 点名了某种食材（「菜」「饭」太泛，不算点名）。
  const askedForFood = /(鸡|鱼|虾|牛|猪|羊|肉|蛋|豆|面|粥|笋|菇|瓜|茄|蟹|贝)/.test(normalized.replace(/(蛋白)/g, ''))
  const ranked = scored
    .filter((entry) => !anyHit || entry.hits > 0)
    .sort((a, b) =>
      b.hits - a.hits
      || tier(a.score) - tier(b.score)
      || hash(`${today}|${a.idea.code}`) - hash(`${today}|${b.idea.code}`))
    .slice(0, limit)

  return {
    slot,
    ideas: ranked.map(({ idea, nutrition }) => ({ idea, nutrition })),
    mealKcal,
    mealProtein,
    remainingKcal,
    remainingProtein,
    topicMissed: askedForFood && !anyHit,
    lean,
  }
}

// ---------------------------------------------------------------------------
// 文字
// ---------------------------------------------------------------------------

const SLOT_LEAD: Record<MealSlot, string> = {
  breakfast: '早饭可以吃',
  lunch: '午饭可以做',
  dinner: '晚饭可以做',
  snack: '加餐可以吃',
}

const roundKcal = (kcal: number) => Math.round(kcal / 10) * 10
const roundProtein = (g: number) => Math.round(g)

function ingredientText(item: IdeaIngredient): string {
  return `${item.label} ${item.grams}g${item.note ? `（${item.note}）` : ''}`
}

export function mealIdeasText(pick: MealIdeaPick): string {
  if (pick.ideas.length === 0) return ''
  const lines: string[] = []
  if (pick.topicMissed) lines.push('你说的这个我这里还没有现成的做法，先看看这些：')
  lines.push(`${SLOT_LEAD[pick.slot]}${pick.ideas.length > 1 ? '这两个' : '这个'}（一人份，热量和蛋白质按食材克数算）：`)
  pick.ideas.forEach(({ idea, nutrition }, index) => {
    lines.push('')
    lines.push(`${index === 0 ? '①' : index === 1 ? '②' : '③'} ${idea.name}`)
    lines.push(`约 ${roundKcal(nutrition.kcal)} kcal · 蛋白质 ${roundProtein(nutrition.protein)} g`)
    lines.push(`食材：${idea.ingredients.map(ingredientText).join('、')}`)
    lines.push(`做法：${idea.steps}`)
  })
  lines.push('')
  if (pick.remainingKcal !== null) {
    const parts = [`今天按已记录的还能吃约 ${roundKcal(Math.max(pick.remainingKcal, 0))} kcal`]
    if (pick.remainingProtein !== null) {
      parts.push(pick.remainingProtein > 0 ? `蛋白质还差约 ${roundProtein(pick.remainingProtein)} g` : '蛋白质已经够了')
    }
    lines.push(`${parts.join('，')}。米饭可以按这个多盛或少盛。`)
  } else if (pick.mealKcal !== null) {
    const protein = pick.mealProtein !== null ? `、蛋白质 ${roundProtein(pick.mealProtein)} g 左右` : ''
    lines.push(`按你的目标，这一餐大约 ${roundKcal(pick.mealKcal)} kcal${protein}，米饭可以按这个加减。`)
  }
  lines.push('数字按爪边食物库算，油和份量不同会有出入。吃了告诉我，我帮你记。')
  return lines.join('\n')
}

export function coachMealIdeasKilled(): boolean {
  const raw = process.env.PAWSIDE_COACH_MEAL_IDEAS?.trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off'
}
