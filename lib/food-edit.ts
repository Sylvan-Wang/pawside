/**
 * 饮食编辑页（app/food/[id]/edit）一行食物的编辑规则。
 *
 * 食物库里的食物（带 foodId）保存时由服务端按每 100 g 重新算营养，输入框里手改的
 * 热量、蛋白质等数字会被悄悄丢掉（#40）。所以：手改了任一营养数字，这一行就转成
 * 「你填写的」（foodId 置空），服务端按用户填的数字原样保存。不改任何计算公式。
 *
 * 改重量时，四项营养按比例当场跟着变（xxa 11-21 批 #84 第 6 条 A）：以打开时的
 * 「重量 + 营养」为基准，新数字 = 基准 × 新重量 / 基准重量。这就是食物库每 100 g
 * 换算的同一个比例，不新增公式，也不调用 AI。手改营养后，基准换成改后的数字。
 */

export interface EditableFood {
  name: string
  weight: string
  calories: string
  protein: string
  carbs: string
  fat: string
  foodId: number | null
  /** Saved from chat as "what was eaten" only: no weight, no nutrition. Kept as such unless filled in. */
  rawOnly?: boolean
  /** 用户在这一行手改过营养数字，已从食物库转成「你填写的」。 */
  manualNutrition?: boolean
  /** 按比例换算的基准：某个重量下的四项营养。没有重量的食物没有基准，改重量不动营养。 */
  basis?: NutritionBasis | null
}

export interface NutritionBasis {
  weight: number
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

const NUTRITION_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const

export function isNutritionKey(key: string): boolean {
  return (NUTRITION_KEYS as readonly string[]).includes(key)
}

const toNumber = (value: string): number | null => {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 用当前输入框里的重量和营养建基准；重量不是正数时没有基准。 */
export function basisOf(item: Pick<EditableFood, 'weight' | 'calories' | 'protein' | 'carbs' | 'fat'>): NutritionBasis | null {
  const weight = toNumber(item.weight)
  if (weight === null || weight <= 0) return null
  return {
    weight,
    calories: toNumber(item.calories),
    protein: toNumber(item.protein),
    carbs: toNumber(item.carbs),
    fat: toNumber(item.fat),
  }
}

// 只为显示取整：热量到整数，三大营养素到 0.1 g。保存时食物库食物仍由服务端按每 100 g 精确计算。
const show = (value: number | null, digits: number): string =>
  value === null ? '' : String(Math.round(value * 10 ** digits) / 10 ** digits)

export function rescaleNutrition(basis: NutritionBasis, weight: number): Pick<EditableFood, 'calories' | 'protein' | 'carbs' | 'fat'> {
  const ratio = weight / basis.weight
  const scale = (value: number | null) => (value === null ? null : value * ratio)
  return {
    calories: show(scale(basis.calories), 0),
    protein: show(scale(basis.protein), 1),
    carbs: show(scale(basis.carbs), 1),
    fat: show(scale(basis.fat), 1),
  }
}

export function applyFoodEdit(item: EditableFood, key: keyof EditableFood, value: string): EditableFood {
  if (key === 'name') return { ...item, name: value, foodId: null }
  const next: EditableFood = { ...item, [key]: value, rawOnly: false }
  if (key === 'weight') {
    const basis = item.basis === undefined ? basisOf(item) : item.basis
    const weight = toNumber(value)
    if (basis && weight !== null && weight > 0) Object.assign(next, rescaleNutrition(basis, weight))
    // 清空或填错重量时营养先不动，基准保留，改回正常数字还能接着换算。
    next.basis = basis
    return next
  }
  if (isNutritionKey(key) && value !== item[key]) {
    if (item.foodId !== null) {
      next.foodId = null
      next.manualNutrition = true
    }
    next.basis = basisOf(next)
  }
  return next
}
