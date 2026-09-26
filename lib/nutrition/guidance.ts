import type { NutrientTargets } from './types'

export interface MealCalorieRange {
  breakfast: [number, number]
  lunch: [number, number]
  dinner: [number, number]
}

function rounded(value: number): number {
  return Math.round(value / 10) * 10
}

/** Non-binding meal guidance. The daily target remains the sole budget truth. */
export function buildMealCalorieRanges(calorieTarget: number | null): MealCalorieRange | null {
  if (calorieTarget === null || !Number.isFinite(calorieTarget) || calorieTarget <= 0) return null
  return {
    breakfast: [rounded(calorieTarget * 0.25), rounded(calorieTarget * 0.30)],
    lunch: [rounded(calorieTarget * 0.30), rounded(calorieTarget * 0.40)],
    dinner: [rounded(calorieTarget * 0.30), rounded(calorieTarget * 0.35)],
  }
}

export function buildTodayGuidance(target: NutrientTargets) {
  return {
    calorieTarget: target.calories_kcal,
    mealRanges: buildMealCalorieRanges(target.calories_kcal),
    proteinTarget: target.protein_g,
    carbTarget: target.carbs_g,
  }
}

export function describeRemaining(value: number | null, unit: string): string {
  if (value === null) return '暂无可比较目标'
  const amount = Math.round(Math.abs(value) * 10) / 10
  return value < 0 ? `已超过参考 ${amount} ${unit}` : `还可参考摄入 ${amount} ${unit}`
}
