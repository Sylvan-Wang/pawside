import { buildWorkoutGuideMedia, type ExerciseMedia, type ExerciseMediaMapping } from '@/lib/exercise-media'
import { METHOD_SPLITS } from '@/lib/method-catalog'
import { createClient } from '@/lib/supabase/server'

export interface MethodLibraryExercise {
  id: string
  key: string
  splitKey: string
  order: number
  name: string
  role: string
  purpose: string
  prescription: string
  intensity: string
  progression: string
  cues: string[]
  why: string
  media: ExerciseMedia | null
}

export interface MethodLibrarySplit {
  key: string
  day: string
  name: string
  focus: string
  exercises: MethodLibraryExercise[]
}

export interface MethodLibraryCatalog {
  releaseId: string | null
  name: string
  version: string
  description: string | null
  source: 'database' | 'fixture'
  splits: MethodLibrarySplit[]
  importEnabled: boolean
}

export interface MethodLibraryItem {
  releaseId: string | null
  name: string
  version: string
  description: string | null
  sourceType: 'official' | 'imported'
  current: boolean
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function fixtureCatalog(importEnabled = false): MethodLibraryCatalog {
  return {
    releaseId: null,
    name: '推 · 拉 · 腿',
    version: '1.2',
    description: '先理解今天为什么这样练。浏览动作不会写入训练记录。',
    source: 'fixture',
    importEnabled,
    splits: METHOD_SPLITS.map((split) => ({
      ...split,
      exercises: split.exercises.map((exercise) => ({
        ...exercise,
        id: exercise.key,
      })),
    })),
  }
}

async function featureEnabled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: 'multi_day_runtime' | 'method_import',
) {
  const { data, error } = await supabase.rpc('feature_enabled', { p_key: key })
  return !error && data === true
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function formatPrescription(fields: Array<{ field_key: string; value_json: unknown }>, fallback: string) {
  const values = new Map(fields.map((field) => [field.field_key, field.value_json]))
  const parts: string[] = []
  const sets = values.get('sets')
  const reps = asObject(values.get('reps'))
  const duration = values.get('duration_seconds')
  const distance = values.get('distance_m')
  if (typeof sets === 'number') parts.push(`${sets} 组`)
  if (typeof reps.min === 'number') {
    parts.push(reps.min === reps.max ? `${reps.min} 次` : `${reps.min}–${reps.max} 次`)
  }
  if (typeof duration === 'number') parts.push(`${duration} 秒`)
  if (typeof distance === 'number') parts.push(`${distance} 米`)
  return parts.join(' × ') || fallback || '按训练日处方执行'
}

export async function loadMethodCatalog(requestedReleaseId?: string): Promise<MethodLibraryCatalog> {
  const supabase = await createClient()
  const [{ data: { user } }, runtimeEnabled, importEnabled] = await Promise.all([
    supabase.auth.getUser(),
    featureEnabled(supabase, 'multi_day_runtime'),
    featureEnabled(supabase, 'method_import'),
  ])
  if (!user || !runtimeEnabled) return fixtureCatalog(importEnabled)

  let releaseId = requestedReleaseId
  if (!releaseId) {
    const { data: enrollment } = await supabase
      .from('method_enrollments')
      .select('method_release_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    releaseId = enrollment?.method_release_id ?? undefined
  }
  if (!releaseId) return fixtureCatalog(importEnabled)

  const { data: release } = await supabase
    .from('method_releases')
    .select('id,method_id,version')
    .eq('id', releaseId)
    .eq('status', 'active')
    .maybeSingle()
  if (!release) return fixtureCatalog(importEnabled)

  const [{ data: method }, { data: splitRows }, { data: ruleRows }] = await Promise.all([
    supabase.from('methods').select('name,description').eq('id', release.method_id).maybeSingle(),
    supabase.from('method_splits')
      .select('id,key,name_zh,order_index,primary_focus,description')
      .eq('method_release_id', release.id)
      .order('order_index'),
    supabase.from('method_rules')
      .select('rule_key,rule_type,config_json,explanation_zh')
      .eq('method_release_id', release.id),
  ])
  if (!method || !splitRows?.length) return fixtureCatalog(importEnabled)

  const splitIds = splitRows.map((split) => split.id)
  const { data: exerciseRows } = await supabase
    .from('method_split_exercises')
    .select(`
      id,method_split_id,exercise_id,order_index,method_role,method_notes,
      prescription_rule_key,progression_rule_key,
      exercise:exercises(
        id,canonical_name_zh,target_regions,
        media_mappings:exercise_external_mappings(
          provider,external_slug,source_version,license,attribution,
          source_url,mapping_status,mapping_notes
        )
      )
    `)
    .in('method_split_id', splitIds)
    .order('order_index')

  const rows = (exerciseRows ?? []) as unknown as Array<Record<string, unknown>>
  const rowIds = rows.map((row) => String(row.id))
  const exerciseIds = rows.map((row) => String(row.exercise_id))
  const [{ data: fieldRows }, { data: cueRows }] = await Promise.all([
    rowIds.length
      ? supabase.from('method_prescription_field_values')
          .select('method_split_exercise_id,field_key,value_json')
          .in('method_split_exercise_id', rowIds)
      : Promise.resolve({ data: [] }),
    exerciseIds.length
      ? supabase.from('exercise_cues')
          .select('exercise_id,text_zh,sort_order')
          .in('exercise_id', exerciseIds)
          .eq('review_status', 'reviewed')
          .order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  const rules = new Map((ruleRows ?? []).map((rule) => [rule.rule_key, rule]))
  const fieldsByRow = new Map<string, Array<{ field_key: string; value_json: unknown }>>()
  for (const field of fieldRows ?? []) {
    const current = fieldsByRow.get(field.method_split_exercise_id) ?? []
    current.push(field)
    fieldsByRow.set(field.method_split_exercise_id, current)
  }
  const cuesByExercise = new Map<string, string[]>()
  for (const cue of cueRows ?? []) {
    const current = cuesByExercise.get(cue.exercise_id) ?? []
    current.push(cue.text_zh)
    cuesByExercise.set(cue.exercise_id, current)
  }

  const splits = splitRows.map((split) => {
    const exercises = rows
      .filter((row) => row.method_split_id === split.id)
      .map((row) => {
        const exercise = firstRelation(row.exercise as Record<string, unknown> | Array<Record<string, unknown>> | null)
        if (!exercise) return null
        const mapping = firstRelation(exercise.media_mappings as ExerciseMediaMapping[] | null)
        const prescriptionRule = rules.get(String(row.prescription_rule_key))
        const progressionRule = rules.get(String(row.progression_rule_key))
        const config = asObject(prescriptionRule?.config_json)
        const importedCues = Array.isArray(config.cues)
          ? config.cues.filter((item): item is string => typeof item === 'string')
          : []
        const summary = typeof config.summary_zh === 'string'
          ? config.summary_zh
          : prescriptionRule?.explanation_zh ?? String(row.method_notes ?? '')
        const targetRegions = Array.isArray(exercise.target_regions)
          ? exercise.target_regions.filter((item): item is string => typeof item === 'string')
          : []
        return {
          id: String(exercise.id),
          key: String(exercise.id),
          splitKey: split.key,
          order: Number(row.order_index),
          name: String(exercise.canonical_name_zh),
          role: String(row.method_role),
          purpose: targetRegions.join('、') || String(row.method_notes ?? ''),
          prescription: formatPrescription(fieldsByRow.get(String(row.id)) ?? [], summary),
          intensity: '以训练中的当日处方与余量提示为准',
          progression: progressionRule?.explanation_zh ?? '完成后按方法规则进入下一次处方',
          cues: [...new Set([...importedCues, ...(cuesByExercise.get(String(exercise.id)) ?? [])])],
          why: String(row.method_notes ?? split.description ?? ''),
          media: mapping ? buildWorkoutGuideMedia(mapping) : null,
        } satisfies MethodLibraryExercise
      })
      .filter((exercise): exercise is MethodLibraryExercise => exercise !== null)
    return {
      key: split.key,
      day: `Day ${split.order_index}`,
      name: split.name_zh,
      focus: split.primary_focus.join(' + ') || split.description || '',
      exercises,
    }
  })

  return {
    releaseId: release.id,
    name: method.name,
    version: release.version,
    description: method.description,
    source: 'database',
    splits,
    importEnabled,
  }
}

export async function loadMethodExercise(exerciseKey: string, releaseId?: string) {
  const catalog = await loadMethodCatalog(releaseId)
  return {
    catalog,
    exercise: catalog.splits.flatMap((split) => split.exercises)
      .find((exercise) => exercise.id === exerciseKey || exercise.key === exerciseKey) ?? null,
  }
}

export async function loadMethodLibrary(): Promise<{ items: MethodLibraryItem[]; importEnabled: boolean }> {
  const supabase = await createClient()
  const [{ data: { user } }, runtimeEnabled, importEnabled] = await Promise.all([
    supabase.auth.getUser(),
    featureEnabled(supabase, 'multi_day_runtime'),
    featureEnabled(supabase, 'method_import'),
  ])
  if (!user || !runtimeEnabled) {
    return {
      importEnabled,
      items: [{ releaseId: null, name: '推 · 拉 · 腿', version: '1.2', description: null, sourceType: 'official', current: true }],
    }
  }
  const [{ data: releases }, { data: enrollment }] = await Promise.all([
    supabase.from('method_releases').select('id,method_id,version').eq('status', 'active').order('created_at'),
    supabase.from('method_enrollments').select('method_release_id').eq('user_id', user.id).eq('status', 'active').maybeSingle(),
  ])
  const methodIds = [...new Set((releases ?? []).map((release) => release.method_id))]
  const { data: methods } = methodIds.length
    ? await supabase.from('methods').select('id,name,description,source_type').in('id', methodIds)
    : { data: [] }
  const methodMap = new Map((methods ?? []).map((method) => [method.id, method]))
  return {
    importEnabled,
    items: (releases ?? []).flatMap((release) => {
      const method = methodMap.get(release.method_id)
      return method ? [{
        releaseId: release.id,
        name: method.name,
        version: release.version,
        description: method.description,
        sourceType: method.source_type as 'official' | 'imported',
        current: enrollment?.method_release_id === release.id,
      }] : []
    }),
  }
}
