/** Canonical meal_type -> the word people read. Older rows may already hold the Chinese word; those pass through. */
const LABELS: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

export function mealTypeLabel(value: string): string {
  return LABELS[value] ?? value
}
