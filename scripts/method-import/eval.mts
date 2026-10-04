import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MethodManifestSchema, type MethodManifest } from '../../lib/contracts/method/manifest.ts'
import { quoteExists } from '../../lib/method-import/normalize-text.ts'

type GoldCase = {
  name: string
  raw_text: string
  manifest: unknown
  expected_days?: Array<{ nameZh: string; dayType: string; exercises: string[] }>
  alignments?: Array<{ match: 'exact' | 'alias' | 'candidate'; correct: boolean; ambiguous: boolean }>
  model?: string
  prompt_versions?: string[]
}

const directory = resolve(process.argv[2] || 'docs/method-import/gold/plans')
let names: string[]
try { names = (await readdir(directory)).filter((name) => name.endsWith('.json')) } catch { names = [] }
if (names.length === 0) {
  console.error(`HOLD: no user-reviewed gold plans in ${directory}; M1-M6 were not claimed.`)
  process.exitCode = 2
} else {
  const cases: GoldCase[] = await Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8'))))
  let explicit = 0; let traceable = 0; let hallucinated = 0; let missingCorrect = 0; let missingTotal = 0
  let exactTotal = 0; let exactCorrect = 0; let ambiguousTotal = 0; let ambiguousCandidate = 0
  let structureTotal = 0; let structureCorrect = 0; let expectedExercises = 0; let recalledExercises = 0

  const visit = (manifest: MethodManifest, raw: string) => {
    for (const day of manifest.days) for (const exercise of day.exercises) for (const set of exercise.sets) {
      for (const field of [set.reps, set.durationSeconds, set.distanceM, set.restSeconds]) {
        if (!field) continue
        if (field.authority === 'method_explicit') {
          explicit += 1
          if (quoteExists(raw, field.quote)) traceable += 1
          else hallucinated += 1
        }
        if (field.value === null) {
          missingTotal += 1
          if (field.authority !== 'method_explicit') missingCorrect += 1
        }
      }
    }
  }

  for (const item of cases) {
    const parsed = MethodManifestSchema.safeParse(item.manifest)
    if (!parsed.success) throw new Error(`${item.name}: invalid manifest: ${parsed.error.message}`)
    visit(parsed.data, item.raw_text)
    for (const alignment of item.alignments ?? []) {
      if (alignment.match === 'exact') { exactTotal += 1; if (alignment.correct) exactCorrect += 1 }
      if (alignment.ambiguous) { ambiguousTotal += 1; if (alignment.match === 'candidate') ambiguousCandidate += 1 }
    }
    if (item.expected_days) {
      structureTotal += item.expected_days.length
      structureCorrect += item.expected_days.filter((day, index) => parsed.data.days[index]?.nameZh === day.nameZh && parsed.data.days[index]?.dayType === day.dayType).length
      for (const [index, day] of item.expected_days.entries()) {
        expectedExercises += day.exercises.length
        const actual = new Set(parsed.data.days[index]?.exercises.map((exercise) => exercise.ref.name) ?? [])
        recalledExercises += day.exercises.filter((name) => actual.has(name)).length
      }
    }
  }
  const pct = (part: number, total: number) => total === 0 ? 100 : part / total * 100
  const metrics = {
    M1_numeric_traceability_pct: pct(traceable, explicit),
    M2_hallucinated_explicit_values: hallucinated,
    M3_missing_annotation_pct: pct(missingCorrect, missingTotal),
    M4_exact_accuracy_pct: pct(exactCorrect, exactTotal),
    M4_ambiguous_candidate_pct: pct(ambiguousCandidate, ambiguousTotal),
    M5_structure_accuracy_pct: pct(structureCorrect, structureTotal),
    M6_exercise_recall_pct: pct(recalledExercises, expectedExercises),
    cases: cases.length,
    models: [...new Set(cases.map((item) => item.model).filter(Boolean))],
    prompt_versions: [...new Set(cases.flatMap((item) => item.prompt_versions ?? []))],
  }
  console.log(JSON.stringify(metrics, null, 2))
  const hardPass = metrics.M1_numeric_traceability_pct === 100
    && metrics.M2_hallucinated_explicit_values === 0
    && metrics.M3_missing_annotation_pct === 100
    && metrics.M4_exact_accuracy_pct >= 98
    && metrics.M4_ambiguous_candidate_pct === 100
  if (!hardPass) { console.error('NO_GO: at least one M1-M4 hard gate failed.'); process.exitCode = 1 }
  else if (metrics.M5_structure_accuracy_pct < 95 || metrics.M6_exercise_recall_pct < 95) {
    console.error('HOLD: M1-M4 passed, but an M5-M6 soft gate is below 95%.'); process.exitCode = 2
  } else console.log('PASS: M1-M6 thresholds met.')
}
