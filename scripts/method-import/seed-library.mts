import { exercises } from '@bryllim/workout-guide'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

interface Translation {
  slug: string
  canonical_name_zh: string
  aliases?: string[]
  risk_flags?: string[]
  cues?: string[]
}

function csv(value: unknown) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const outputPath = resolve(argument('--output') || 'docs/method-import/gold/exercise-library-review.csv')
const translationsPath = argument('--translations')
const translations: Translation[] = translationsPath
  ? JSON.parse(await readFile(resolve(translationsPath), 'utf8'))
  : []
const bySlug = new Map(translations.map((item) => [item.slug, item]))

const chineseNames = new Map<string, string[]>()
const aliases = new Map<string, string[]>()
for (const item of translations) {
  if (item.canonical_name_zh.trim()) {
    const current = chineseNames.get(item.canonical_name_zh.trim()) ?? []
    current.push(item.slug)
    chineseNames.set(item.canonical_name_zh.trim(), current)
  }
  for (const alias of item.aliases ?? []) {
    const current = aliases.get(alias.trim()) ?? []
    current.push(item.slug)
    aliases.set(alias.trim(), current)
  }
}

const headers = [
  'approved', 'conflict', 'slug', 'canonical_name_en', 'canonical_name_zh', 'aliases',
  'exercise_type', 'record_shape', 'equipment', 'primary_muscle', 'secondary_muscles',
  'is_stretch', 'risk_flags', 'cues', 'review_status',
  'beginner_sets_min', 'beginner_sets_max', 'beginner_reps_min', 'beginner_reps_max',
  'beginner_rest_seconds_min', 'beginner_rest_seconds_max', 'duration_seconds', 'distance_m',
  'failure_policy', 'substitutions',
]
const rows = exercises.map((exercise) => {
  const translation = bySlug.get(exercise.slug)
  const nameZh = translation?.canonical_name_zh.trim() ?? ''
  const conflict: string[] = []
  if (!nameZh) conflict.push('missing_translation')
  if (nameZh && (chineseNames.get(nameZh)?.length ?? 0) > 1) conflict.push('duplicate_chinese_name')
  if ((translation?.aliases ?? []).some((alias) => (aliases.get(alias.trim())?.length ?? 0) > 1)) conflict.push('duplicate_alias')
  const recordShape = exercise.exerciseType === 'duration'
    ? 'duration'
    : exercise.exerciseType === 'distance_duration' ? 'distance_duration' : 'weight_reps'
  return [
    false, conflict.join('|'), exercise.slug, exercise.name, nameZh, translation?.aliases ?? [],
    exercise.exerciseType, recordShape, exercise.equipment, exercise.primaryMuscle,
    exercise.secondaryMuscles, exercise.isStretch, translation?.risk_flags ?? [],
    translation?.cues ?? [], 'draft', '', '', '', '', '', '', '', '', 'avoid', '',
  ].map(csv).join(',')
})

if (rows.length !== 302) throw new Error(`Expected 302 workout-guide exercises, received ${rows.length}`)
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${headers.map(csv).join(',')}\n${rows.join('\n')}\n`, 'utf8')
console.log(`Wrote ${rows.length} review rows to ${outputPath}`)
console.log(`Translations supplied: ${translations.length}; conflicts or missing translations: ${rows.filter((row) => !row.startsWith('"false","","')).length}`)
