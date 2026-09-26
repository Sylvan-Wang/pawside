import type { FoodNutritionPer100g } from './types'

export type ResolutionSource =
  | 'user_memory'
  | 'canonical_db'
  | 'candidate_cache'
  | 'ai_estimate'
  | 'user_override'
  | 'unresolved'

export function normalizeFoodName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

export function resolutionLabel(source: ResolutionSource): string {
  switch (source) {
    case 'canonical_db': return '食物数据库'
    case 'ai_estimate': return 'AI 估算'
    case 'user_override': return '你填写的'
    case 'user_memory': return '上次确认'
    case 'candidate_cache': return '已确认估算'
    default: return '还缺少营养信息'
  }
}

export function actualToPer100g(input: {
  weightG: number
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG?: number | null
}): FoodNutritionPer100g {
  if (!Number.isFinite(input.weightG) || input.weightG <= 0) throw new Error('重量必须大于 0')
  const scale = 100 / input.weightG
  return {
    basis_type: 'per_100g',
    energy_kcal: input.energyKcal * scale,
    protein_g: input.proteinG * scale,
    carb_g: input.carbG * scale,
    fat_g: input.fatG * scale,
    fiber_g: input.fiberG == null ? null : input.fiberG * scale,
  }
}

export function isCompleteNutrition(value: {
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
}): boolean {
  return [value.energy_kcal, value.protein_g, value.carb_g, value.fat_g]
    .every(item => item !== null && Number.isFinite(item) && item >= 0)
}
