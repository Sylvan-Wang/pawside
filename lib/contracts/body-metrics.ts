export const bodyMetricNumberFields = [
  'weight_kg',
  'body_fat_pct',
  'muscle_mass',
  'chest_cm',
  'waist_cm',
  'hip_cm',
  'left_arm_cm',
  'right_arm_cm',
  'left_thigh_cm',
  'right_thigh_cm',
  'left_calf_cm',
  'right_calf_cm',
] as const

export type BodyMetricNumberField = (typeof bodyMetricNumberFields)[number]

export interface BodyMetricsInput extends Record<BodyMetricNumberField, number | null> {
  date: string
  custom_metrics: Record<string, number> | null
  notes: string | null
}

type ValidationResult =
  | { success: true; data: BodyMetricsInput }
  | { success: false; issues: string[] }

const allowedFields = new Set<string>([
  'date',
  ...bodyMetricNumberFields,
  'custom_metrics',
  'notes',
])

const numberRanges: Record<BodyMetricNumberField, { min: number; max: number }> = {
  weight_kg: { min: 0, max: 500 },
  body_fat_pct: { min: 0, max: 100 },
  muscle_mass: { min: 0, max: 500 },
  chest_cm: { min: 0, max: 500 },
  waist_cm: { min: 0, max: 500 },
  hip_cm: { min: 0, max: 500 },
  left_arm_cm: { min: 0, max: 500 },
  right_arm_cm: { min: 0, max: 500 },
  left_thigh_cm: { min: 0, max: 500 },
  right_thigh_cm: { min: 0, max: 500 },
  left_calf_cm: { min: 0, max: 500 },
  right_calf_cm: { min: 0, max: 500 },
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parseBodyMetricsInput(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, issues: ['请求内容必须是对象'] }
  }

  const input = value as Record<string, unknown>
  const issues: string[] = []
  const unknownFields = Object.keys(input).filter((field) => !allowedFields.has(field))
  if (unknownFields.length > 0) {
    issues.push(`不支持的字段：${unknownFields.join('、')}`)
  }

  if (typeof input.date !== 'string' || !isIsoDate(input.date)) {
    issues.push('date 必须是有效的 YYYY-MM-DD 日期')
  }

  const metrics = {} as Record<BodyMetricNumberField, number | null>
  for (const field of bodyMetricNumberFields) {
    const raw = input[field]
    if (raw === undefined || raw === null) {
      metrics[field] = null
      continue
    }

    const { min, max } = numberRanges[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= min || raw > max) {
      issues.push(`${field} 必须是大于 ${min} 且不超过 ${max} 的有效数字`)
      metrics[field] = null
      continue
    }
    metrics[field] = raw
  }

  let customMetrics: Record<string, number> | null = null
  if (input.custom_metrics !== undefined && input.custom_metrics !== null) {
    if (typeof input.custom_metrics !== 'object' || Array.isArray(input.custom_metrics)) {
      issues.push('custom_metrics 必须是数字值对象或 null')
    } else {
      const entries = Object.entries(input.custom_metrics as Record<string, unknown>)
      if (entries.length > 20) issues.push('custom_metrics 最多包含 20 个指标')

      customMetrics = {}
      for (const [rawName, rawValue] of entries) {
        const name = rawName.trim()
        if (!name || name.length > 100) {
          issues.push('自定义指标名称必须为 1 到 100 个字符')
          continue
        }
        if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || Math.abs(rawValue) > 1_000_000_000) {
          issues.push(`自定义指标 ${name} 必须是有效数字`)
          continue
        }
        if (Object.prototype.hasOwnProperty.call(customMetrics, name)) {
          issues.push(`自定义指标名称重复：${name}`)
          continue
        }
        customMetrics[name] = rawValue
      }
      if (Object.keys(customMetrics).length === 0) customMetrics = null
    }
  }

  let notes: string | null = null
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== 'string') {
      issues.push('notes 必须是文本或 null')
    } else if (input.notes.length > 2000) {
      issues.push('notes 最多 2000 个字符')
    } else {
      notes = input.notes.trim() || null
    }
  }

  const hasMeasurement = bodyMetricNumberFields.some((field) => metrics[field] !== null) || customMetrics !== null
  if (!hasMeasurement) issues.push('请至少提供一个身体指标')

  if (issues.length > 0) return { success: false, issues }

  return {
    success: true,
    data: {
      date: input.date as string,
      ...metrics,
      custom_metrics: customMetrics,
      notes,
    },
  }
}
