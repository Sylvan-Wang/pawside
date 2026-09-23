import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../supabase/migrations/20260911000100_generate_cycle_session_prescriptions.sql', import.meta.url),
  'utf8',
)

describe('cycle session prescription migration', () => {
  it('generates a release-pinned ready prescription from an active cycle', () => {
    expect(sql).toContain('create_session_prescription_for_cycle')
    expect(sql).toContain("release.status = 'active'")
    expect(sql).toContain("release.runtime_gate_status = 'passed'")
    expect(sql).toContain("'ready'")
  })

  it('is idempotent for an open cycle and split', () => {
    expect(sql).toContain('existing_prescription_id')
    expect(sql).toContain("prescription.status in ('upcoming', 'ready', 'started', 'rest_deferred')")
    expect(sql).toContain('return existing_prescription_id')
  })

  it('creates set rows only from active structured field values', () => {
    expect(sql).toContain("sets.field_key = 'sets'")
    expect(sql).toContain("reps.field_key = 'reps'")
    expect(sql).toContain("sets.runtime_status in ('active', 'fallback_active')")
    expect(sql).toContain("reps.runtime_status in ('active', 'fallback_active')")
  })

  it('does not expose the generator to app roles', () => {
    expect(sql).toContain('from public, anon, authenticated')
  })
})
