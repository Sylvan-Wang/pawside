import { MethodManifestSchema, type MethodManifest } from '../contracts/method/manifest'
import type { DayExtraction, OutlineExtraction } from './extract-schema'
import { normalizeMethodText, quoteExists } from './normalize-text'
import { parseQuantities, quantityWithinLimits } from './parse-quantities'

const INSTRUCTION_LIKE = /忽略(?:以上|之前).{0,8}指令|系统提示|system\s*(?:prompt|message)|developer\s*message/i

export interface VerificationIssue { rule: `R${number}`; path: string; message: string }

export function verifyQuote(rawText: string, quote: string | null, path: string): VerificationIssue[] {
  if (!quoteExists(rawText, quote)) return [{ rule: 'R1', path, message: '引用不在原文中' }]
  if (quote && INSTRUCTION_LIKE.test(quote)) return [{ rule: 'R9', path, message: '引用包含指令样文本，已丢弃' }]
  return []
}

export function verifyOutline(rawText: string, outline: OutlineExtraction, selectedVariant?: string) {
  const issues: VerificationIssue[] = []
  if (!outline.looks_like_training_plan) issues.push({ rule: 'R6', path: 'outline', message: '这段文字里没有找到训练计划，换一段试试。' })
  if (outline.days.length > 14) issues.push({ rule: 'R4', path: 'days', message: '训练日超过 14 天，已截断' })
  if (outline.variants.length > 1 && !selectedVariant) issues.push({ rule: 'R8', path: 'variants', message: '请先选择要导入的方案' })
  outline.days.forEach((day, index) => issues.push(...verifyQuote(rawText, day.section_quote, `days.${index}.section_quote`)))
  return issues
}

export function verifyDay(rawText: string, day: DayExtraction) {
  const issues: VerificationIssue[] = []
  if (day.exercises.length > 12) issues.push({ rule: 'R4', path: 'exercises', message: '每天最多保留 12 个动作' })
  const names = new Set<string>()
  day.exercises.forEach((exercise, index) => {
    const base = `exercises.${index}`
    issues.push(...verifyQuote(rawText, exercise.quote, `${base}.quote`))
    if (exercise.name.trim().length < 1 || exercise.name.trim().length > 40) issues.push({ rule: 'R5', path: `${base}.name`, message: '动作名称长度无效' })
    const normalizedName = normalizeMethodText(exercise.name)
    if (names.has(normalizedName)) issues.push({ rule: 'R5', path: `${base}.name`, message: '同一天内同名动作需要合并' })
    names.add(normalizedName)
    for (const [key, phrase] of Object.entries(exercise).filter(([key]) => key.endsWith('_phrase'))) {
      if (!phrase || typeof phrase !== 'string') continue
      issues.push(...verifyQuote(rawText, phrase, `${base}.${key}`))
      const parsed = parseQuantities(phrase)
      if (!quantityWithinLimits(parsed)) issues.push({ rule: 'R3', path: `${base}.${key}`, message: '数量超出安全范围' })
      for (const number of phrase.match(/\d+(?:\.\d+)?/g) ?? []) {
        if (!normalizeMethodText(phrase).includes(number)) issues.push({ rule: 'R2', path: `${base}.${key}`, message: '解析数字不在对应短语中' })
      }
    }
    exercise.alternatives.forEach((alternative, alternativeIndex) => {
      issues.push(...verifyQuote(rawText, alternative.quote, `${base}.alternatives.${alternativeIndex}.quote`))
    })
    exercise.cues.forEach((cue, cueIndex) => {
      issues.push(...verifyQuote(rawText, cue.quote, `${base}.cues.${cueIndex}.quote`))
    })
  })
  day.warmup_notes.forEach((item, index) => issues.push(...verifyQuote(rawText, item.quote, `warmup_notes.${index}.quote`)))
  day.cooldown_notes.forEach((item, index) => issues.push(...verifyQuote(rawText, item.quote, `cooldown_notes.${index}.quote`)))
  return issues
}

export function verifyManifestSource(rawText: string, manifest: MethodManifest) {
  const issues: VerificationIssue[] = []
  manifest.days.forEach((day, dayIndex) => day.exercises.forEach((exercise, exerciseIndex) => {
    exercise.sets.forEach((set, setIndex) => {
      for (const [key, field] of Object.entries({ reps: set.reps, durationSeconds: set.durationSeconds, distanceM: set.distanceM, restSeconds: set.restSeconds })) {
        if (field?.authority === 'method_explicit') {
          issues.push(...verifyQuote(rawText, field.quote, `days.${dayIndex}.exercises.${exerciseIndex}.sets.${setIndex}.${key}.quote`))
        }
      }
    })
  }))
  return issues
}

export function verifyManifest(manifest: MethodManifest) {
  const parsed = MethodManifestSchema.safeParse(manifest)
  if (!parsed.success) return parsed.error.issues.map((issue) => ({ rule: 'R10' as const, path: issue.path.join('.'), message: issue.message }))
  return []
}
