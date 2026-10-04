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
  verificationIssues?: Array<{ path: string; message: string }>
}

export interface ManifestExerciseDefaultRow {
  exercise_id: string
  sets_min: number | null
  sets_max: number | null
  reps_min: number | null
  reps_max: number | null
  rest_seconds_min: number | null
  rest_seconds_max: number | null
  duration_seconds: number | null
  distance_m: number | string | null
  failure_policy: 'avoid' | 'allowed' | 'required'
  review_status: 'draft' | 'reviewed'
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
  for (const issue of input.verificationIssues ?? []) {
    if (!openQuestions.some((question) => question.path === issue.path && question.question === issue.message)) {
      openQuestions.push({ path: issue.path, question: issue.message })
    }
  }
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
      if (!exercise.role_hint) openQuestions.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.role`, question: `${exercise.name} 缺少训练角色，需要确认` })
      if (!parsed.sets) openQuestions.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.sets.count`, question: `${exercise.name} 缺少组数，需要确认` })
      if (!parsed.reps && !parsed.duration && !parsed.distanceM) openQuestions.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.sets`, question: `${exercise.name} 缺少可执行的次数、时长或距离` })
      if (!parsed.failure) openQuestions.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.sets.failure`, question: `${exercise.name} 缺少力竭策略，需要确认` })
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
      focusRegions: [],
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

/** Apply only persisted exercise defaults; reviewed rows are runtime-safe while
 * draft rows remain AI suggestions until the user explicitly accepts them. */
export function applyExerciseDefaults(
  manifest: MethodManifest,
  rows: ManifestExerciseDefaultRow[],
): MethodManifest {
  const byExercise = new Map(rows.map((row) => [row.exercise_id, row]))
  const next = structuredClone(manifest)
  next.days.forEach((day, dayIndex) => day.exercises.forEach((exercise, exerciseIndex) => {
    const row = exercise.ref.exerciseId ? byExercise.get(exercise.ref.exerciseId) : null
    if (!row) return
    const authority = row.review_status === 'reviewed' ? 'library_default' as const : 'ai_inferred' as const
    const confidence = row.review_status === 'reviewed' ? 'high' as const : 'low' as const
    const sourcedDefault = <T>(value: T) => ({ value, authority, quote: null, confidence, note: '动作库默认值' })
    const path = `days.${dayIndex}.exercises.${exerciseIndex}.sets`
    const countPath = `${path}.count`
    const failurePath = `${path}.failure`
    const needsSetCountDefault = next.openQuestions.some((question) => question.path === countPath)
    const needsFailureDefault = next.openQuestions.some((question) => question.path === failurePath)
    const setCount = needsSetCountDefault && row.sets_min != null
      ? Math.max(1, Math.min(12, row.sets_max ?? row.sets_min))
      : exercise.sets.length
    const minimumSets = needsSetCountDefault && row.sets_min != null ? row.sets_min : exercise.sets.filter((set) => !set.optional).length
    const template = exercise.sets[0]
    exercise.sets = Array.from({ length: setCount }, (_, setIndex) => {
      const current = exercise.sets[setIndex] ?? template
      return {
        ...current,
        reps: current.reps ?? (row.reps_min == null ? null : sourcedDefault({ min: row.reps_min, max: row.reps_max ?? row.reps_min, perSide: false })),
        restSeconds: current.restSeconds ?? (row.rest_seconds_min == null ? null : sourcedDefault({ min: row.rest_seconds_min, max: row.rest_seconds_max ?? row.rest_seconds_min })),
        durationSeconds: current.durationSeconds ?? (row.duration_seconds == null ? null : sourcedDefault(row.duration_seconds)),
        distanceM: current.distanceM ?? (row.distance_m == null ? null : sourcedDefault(Number(row.distance_m))),
        failure: needsFailureDefault ? row.failure_policy : current.failure,
        optional: current.optional || setIndex >= minimumSets,
      }
    })
    const executable = exercise.sets.some((set) => set.reps || set.durationSeconds || set.distanceM)
    if (executable) next.openQuestions = next.openQuestions.filter((question) => question.path !== path)
    if (row.sets_min != null) next.openQuestions = next.openQuestions.filter((question) => question.path !== countPath)
    next.openQuestions = next.openQuestions.filter((question) => question.path !== failurePath)
    if (executable && row.review_status === 'draft') {
      next.openQuestions.push({ path, question: `${exercise.ref.name} 使用了待确认的动作库建议` })
    }
    if (row.review_status === 'draft') {
      if (needsSetCountDefault && row.sets_min != null) next.openQuestions.push({ path: countPath, question: `${exercise.ref.name} 的组数来自待确认的动作库建议` })
      if (needsFailureDefault) next.openQuestions.push({ path: failurePath, question: `${exercise.ref.name} 的力竭策略来自待确认的动作库建议` })
    }
  }))
  return MethodManifestSchema.parse(next)
}
