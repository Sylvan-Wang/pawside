import { MethodManifestSchema, type MethodManifest } from '../contracts/method/manifest'
import type { DayExtraction, OutlineExtraction } from './extract-schema'
import { parseQuantities } from './parse-quantities'
import { quoteExists } from './normalize-text'

export interface BuildManifestInput {
  rawText: string
  checksumSha256: string
  outline: OutlineExtraction
  days: DayExtraction[]
  consent: { version: string; acceptedAt: string }
  selectedVariant?: string
  title?: string | null
}

function sourced<T>(value: T | null, quote: string | null) {
  return { value, authority: 'method_explicit' as const, quote, confidence: 'high' as const, note: null }
}

function dayKey(name: string, index: number, used: Set<string>) {
  const ascii = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const base = /^[a-z]/.test(ascii) ? ascii.slice(0, 24) : `day_${index + 1}`
  let key = base
  let suffix = 2
  while (used.has(key)) key = `${base}_${suffix++}`
  used.add(key)
  return key
}

export function buildMethodManifest(input: BuildManifestInput): MethodManifest {
  if (!input.outline.looks_like_training_plan) throw new Error('这段文字里没有找到训练计划，换一段试试。')
  if (input.outline.variants.length > 1 && !input.selectedVariant) throw new Error('请先选择要导入的方案')
  const usedKeys = new Set<string>()
  const openQuestions = input.outline.open_questions.map((item, index) => ({ path: `outline.open_questions.${index}`, question: item.question }))
  const selectedDays = input.outline.days
    .filter((day) => !input.selectedVariant || day.variant_label == null || day.variant_label === input.selectedVariant)
    .slice(0, 14)

  const days = selectedDays.map((outlineDay, dayIndex) => {
    const extracted = input.days[dayIndex] ?? { exercises: [], warmup_notes: [], cooldown_notes: [] }
    const exercises = extracted.exercises.slice(0, 12).map((exercise, exerciseIndex) => {
      if (!quoteExists(input.rawText, exercise.quote)) openQuestions.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}`, question: `${exercise.name} 的引用需要确认` })
      const phrases = [exercise.sets_phrase, exercise.reps_phrase, exercise.rest_phrase, exercise.duration_phrase, exercise.distance_phrase, exercise.failure_phrase, exercise.per_side_phrase].filter(Boolean).join('，')
      const parsed = parseQuantities(phrases || exercise.quote)
      const setCount = Math.max(1, Math.min(12, parsed.sets?.max ?? 1))
      const minimumSets = parsed.sets?.min ?? setCount
      if (!parsed.reps && !parsed.duration && !parsed.distanceM) openQuestions.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.sets`, question: `${exercise.name} 缺少可执行的次数、时长或距离` })
      return {
        ref: { name: exercise.name.slice(0, 40), exerciseId: null, match: 'candidate' as const },
        role: exercise.role_hint ?? 'accessory' as const,
        sets: Array.from({ length: setCount }, (_, setIndex) => ({
          type: parsed.restPauseReps ? 'rest_pause' as const : 'working' as const,
          reps: parsed.reps ? sourced({ ...parsed.reps, perSide: parsed.perSide }, exercise.reps_phrase) : null,
          durationSeconds: parsed.duration ? sourced(parsed.duration.min, exercise.duration_phrase) : null,
          distanceM: parsed.distanceM ? sourced(parsed.distanceM.min, exercise.distance_phrase) : null,
          restSeconds: parsed.restSeconds ? sourced(parsed.restSeconds, exercise.rest_phrase) : null,
          failure: parsed.failure === 'required_or_allowed' ? 'allowed' as const : parsed.failure ?? 'avoid' as const,
          optional: setIndex >= minimumSets,
          qualityNote: parsed.sequenceReps ? `递减次数：${parsed.sequenceReps.join('/')}` : parsed.restPauseReps ? `休息暂停：${parsed.restPauseReps.join('+')}` : null,
        })),
        substitutions: exercise.alternatives.map((alternative) => ({ name: alternative.name.slice(0, 40), exerciseId: null, match: 'candidate' as const })),
        cues: exercise.cues.filter((cue) => quoteExists(input.rawText, cue.quote)).map((cue) => cue.text.slice(0, 200)),
        notes: parsed.progressionPercent ? `原文递进备注：每周增加 ${parsed.progressionPercent.min}-${parsed.progressionPercent.max}%` : null,
      }
    })
    return {
      key: dayKey(outlineDay.name_zh, dayIndex, usedKeys), nameZh: outlineDay.name_zh.slice(0, 40), order: dayIndex + 1,
      dayType: outlineDay.day_type, required: outlineDay.day_type === 'strength', minGapDays: 0,
      focusRegions: [outlineDay.name_zh.slice(0, 40)],
      warmupNotes: extracted.warmup_notes.filter((item) => quoteExists(input.rawText, item.quote)).map((item) => item.text.slice(0, 200)),
      cooldownNotes: extracted.cooldown_notes.filter((item) => quoteExists(input.rawText, item.quote)).map((item) => item.text.slice(0, 200)),
      exercises,
    }
  })
  return MethodManifestSchema.parse({
    schemaVersion: 2,
    method: { nameZh: input.outline.method_name || '我的训练方法', summary: input.outline.reason || null, level: input.outline.level_hint, equipmentRequirement: null },
    source: { kind: 'pasted_text', checksumSha256: input.checksumSha256, title: input.title ?? null },
    days,
    openQuestions,
    consent: input.consent,
  })
}
