/**
 * 饮食编辑页（app/food/[id]/edit）一行食物的编辑规则。
 *
 * 食物库里的食物（带 foodId）保存时由服务端按每 100 g 重新算营养，输入框里手改的
 * 热量、蛋白质等数字会被悄悄丢掉（#40）。所以：手改了任一营养数字，这一行就转成
 * 「你填写的」（foodId 置空），服务端按用户填的数字原样保存。不改任何计算公式。
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
}

const NUTRITION_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const

export function isNutritionKey(key: string): boolean {
  return (NUTRITION_KEYS as readonly string[]).includes(key)
}

export function applyFoodEdit(item: EditableFood, key: keyof EditableFood, value: string): EditableFood {
  if (key === 'name') return { ...item, name: value, foodId: null }
  const next: EditableFood = { ...item, [key]: value, rawOnly: false }
  if (isNutritionKey(key) && item.foodId !== null && value !== item[key]) {
    next.foodId = null
    next.manualNutrition = true
  }
  return next
}
