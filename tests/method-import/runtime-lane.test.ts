import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('method import runtime lane', () => {
  it('keeps v3 completion on the generalized helpers and preserves the duration implementation', async () => {
    const sql = await readFile('supabase/migrations/20261004002100_complete_method_session_v3.sql', 'utf8')
    expect(sql).toContain('workout_log_type_for_split')
    expect(sql).toContain('next_program_day')
    expect(sql).toContain('min_gap_days')
    expect(sql).toContain('selected_session_minutes')
    expect(sql).toContain("in ('replay', 'supplemental')")
  })

  it('keeps new runtime entry points behind default-off gates', async () => {
    const files = await Promise.all([
      '20261004002000_program_day_runtime_v2.sql',
      '20261004002100_complete_method_session_v3.sql',
      '20261004002200_enroll_in_method_release_v1.sql',
      '20261004002400_method_adjustment_functions.sql',
    ].map((name) => readFile(`supabase/migrations/${name}`, 'utf8')))
    for (const sql of files) expect(sql).toContain('feature_enabled')
  })

  it('renders Method pages from the database adapter while retaining the old catalog as fallback fixture', async () => {
    const [overview, detail, adapter] = await Promise.all([
      readFile('app/training/method/page.tsx', 'utf8'),
      readFile('app/training/method/[exerciseKey]/page.tsx', 'utf8'),
      readFile('lib/method-library.ts', 'utf8'),
    ])
    expect(overview).toContain('loadMethodCatalog')
    expect(detail).toContain('loadMethodExercise')
    expect(adapter).toContain("source: 'database'")
    expect(adapter).toContain('METHOD_SPLITS')
  })

  it('never falls back to raw generalized split keys in user-visible coaching copy', async () => {
    const files = await Promise.all([
      'lib/coach/workout-context.ts',
      'lib/evidence/daily-review.ts',
      'lib/history/daily-workout-card.ts',
    ].map((name) => readFile(name, 'utf8')))
    for (const source of files) expect(source).not.toMatch(/\|\|\s*(session\.)?split_key/)
  })
})
