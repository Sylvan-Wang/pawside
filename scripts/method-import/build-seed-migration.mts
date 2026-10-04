import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []; let field = ''; let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
    else if (char === '"') quoted = !quoted
    else if (!quoted && char === ',') { row.push(field); field = '' }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''
    } else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const headers = rows.shift() ?? []
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const nullableNumber = (value: string) => value.trim() ? Number(value).toString() : 'null'
const array = (value: string) => `array[${value.split('|').filter(Boolean).map(q).join(',')}]::text[]`
const inputPath = resolve(argument('--input') || 'docs/method-import/gold/exercise-library-review.csv')
const outputPath = resolve(argument('--output') || 'supabase/migrations/20261004004000_reviewed_gold_exercise_seed.sql')
const rows = parseCsv(await readFile(inputPath, 'utf8')).filter((row) => row.approved.toLowerCase() === 'true')
if (rows.length === 0) {
  console.error('HOLD: no approved=true rows in the review CSV; no migration was written.')
  process.exitCode = 2
} else {
  const statements: string[] = ['-- Generated only from user-reviewed approved=true rows.', 'begin;']
  const approvedBySlug = new Map(rows.map((row) => [row.slug, row]))
  for (const row of rows) {
    if (!row.canonical_name_zh.trim()) throw new Error(`Approved row ${row.slug} has no Chinese canonical name`)
    statements.push(`insert into public.exercises (canonical_name_zh, canonical_name_en, aliases, movement_pattern, target_regions, equipment, review_status, record_shape, risk_flags) values (${q(row.canonical_name_zh)}, ${q(row.canonical_name_en)}, ${array(row.aliases)}, null, ${array([row.primary_muscle, ...row.secondary_muscles.split('|')].filter(Boolean).join('|'))}, ${array(row.equipment)}, 'reviewed', ${q(row.record_shape)}, ${array(row.risk_flags)}) on conflict (canonical_name_zh) do nothing;`)
    statements.push(`insert into public.exercise_external_mappings (exercise_id, provider, external_slug, source_version, license, attribution, source_url, mapping_status) select id, '@bryllim/workout-guide', ${q(row.slug)}, '1.0.0', 'CC BY-SA 4.0', 'Original exercise artwork by Everkinetic, expanded by Bryl Lim, licensed under CC BY-SA 4.0.', 'https://bryllim.github.io/workout-guide/exercises/${row.slug}/', 'candidate' from public.exercises where canonical_name_zh = ${q(row.canonical_name_zh)} on conflict do nothing;`)
    statements.push(`insert into public.exercise_defaults (exercise_id, level, sets_min, sets_max, reps_min, reps_max, rest_seconds_min, rest_seconds_max, duration_seconds, distance_m, failure_policy, review_status, source_note) select id, 'beginner', ${nullableNumber(row.beginner_sets_min)}, ${nullableNumber(row.beginner_sets_max)}, ${nullableNumber(row.beginner_reps_min)}, ${nullableNumber(row.beginner_reps_max)}, ${nullableNumber(row.beginner_rest_seconds_min)}, ${nullableNumber(row.beginner_rest_seconds_max)}, ${nullableNumber(row.duration_seconds)}, ${nullableNumber(row.distance_m)}, ${q(row.failure_policy || 'avoid')}, 'reviewed', 'User-reviewed workout-guide seed.' from public.exercises where canonical_name_zh = ${q(row.canonical_name_zh)} on conflict (exercise_id, level) do nothing;`)
    for (const [index, cue] of row.cues.split('|').filter(Boolean).entries()) {
      statements.push(`insert into public.exercise_cues (exercise_id, kind, text_zh, sort_order, review_status) select id, 'execution', ${q(cue)}, ${index + 1}, 'reviewed' from public.exercises where canonical_name_zh = ${q(row.canonical_name_zh)} and not exists (select 1 from public.exercise_cues c where c.exercise_id = exercises.id and c.text_zh = ${q(cue)});`)
    }
  }
  for (const row of rows) {
    for (const substituteSlug of row.substitutions.split('|').filter(Boolean)) {
      const substitute = approvedBySlug.get(substituteSlug)
      if (!substitute) throw new Error(`Approved row ${row.slug} references unapproved substitution ${substituteSlug}`)
      statements.push(`insert into public.exercise_substitutions (exercise_id, substitute_exercise_id, kind, note, review_status) select source.id, target.id, 'swap', 'User-reviewed workout-guide substitution.', 'reviewed' from public.exercises source cross join public.exercises target where source.canonical_name_zh = ${q(row.canonical_name_zh)} and target.canonical_name_zh = ${q(substitute.canonical_name_zh)} and source.id <> target.id on conflict do nothing;`)
    }
  }
  statements.push('commit;', '')
  await writeFile(outputPath, statements.join('\n'), 'utf8')
  console.log(`Wrote ${rows.length} approved exercise rows to ${outputPath}`)
}
