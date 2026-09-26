export interface FoodHistorySuggestion {
  id: string
  name: string
  weight_g: number
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

export interface LegacyFoodLogRow {
  id: string
  foods: unknown
}

function optionalNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function buildFoodHistorySuggestions(
  logs: LegacyFoodLogRow[],
  limit: number,
): FoodHistorySuggestion[] {
  const suggestions: FoodHistorySuggestion[] = []
  const seen = new Set<string>()

  for (const log of logs) {
    if (!Array.isArray(log.foods)) continue

    for (const [index, value] of log.foods.entries()) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const weight = Number(item.weight_g ?? item.weight)
      if (!name || !Number.isFinite(weight) || weight <= 0) continue

      const calories = optionalNonNegativeNumber(item.calories ?? item.energy_kcal)
      const protein = optionalNonNegativeNumber(item.protein_g)
      // Legacy rows carry carbs/fat only when the item was written after the
      // four-macro bridge landed; older rows legitimately stay null.
      const carbs = optionalNonNegativeNumber(item.carbs_g ?? item.carb_g)
      const fat = optionalNonNegativeNumber(item.fat_g)
      const identity = JSON.stringify([
        name.toLocaleLowerCase(),
        weight,
        calories,
        protein,
        carbs,
        fat,
      ])
      if (seen.has(identity)) continue

      seen.add(identity)
      suggestions.push({
        id: `${log.id}:${index}`,
        name,
        weight_g: weight,
        calories,
        protein_g: protein,
        carbs_g: carbs,
        fat_g: fat,
      })
      if (suggestions.length >= limit) return suggestions
    }
  }

  return suggestions
}
