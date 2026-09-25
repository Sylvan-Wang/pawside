export type TrainingWeightUnit = 'kg' | 'lb'

export const KG_PER_LB = 0.45359237

export function weightInputToKg(value: number, unit: TrainingWeightUnit) {
  if (!Number.isFinite(value)) return null
  const kg = unit === 'lb' ? value * KG_PER_LB : value
  return Math.round(kg * 1000) / 1000
}

export function kgToWeightInput(valueKg: number | null, unit: TrainingWeightUnit) {
  if (valueKg == null || !Number.isFinite(valueKg)) return ''
  const displayValue = unit === 'lb' ? valueKg / KG_PER_LB : valueKg
  const precision = unit === 'lb' ? 1 : 3
  return String(Number(displayValue.toFixed(precision)))
}

export function normalizeTrainingWeightUnit(value: unknown): TrainingWeightUnit {
  return value === 'lb' ? 'lb' : 'kg'
}
