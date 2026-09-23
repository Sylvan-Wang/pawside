import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260910000100_method_enrollment_foundation.sql'

describe('Phase 2 enrollment migration', () => {
  it('pins every newly active enrollment to a Method release', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain('method_release_id uuid references public.method_releases')
    expect(sql).toContain("check (status <> 'active' or method_release_id is not null) not valid")
    expect(sql).toContain("'method_release_id', target_release_id")
  })

  it('creates enrollment and Cycle 1 atomically through a security-definer RPC', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain('security definer')
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain('insert into public.method_enrollments')
    expect(sql).toContain('insert into public.method_cycles')
    expect(sql).toContain("'next_split_key', 'push'")
  })

  it('does not enroll against a merely validated release or incompatible equipment', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain("release.status = 'active'")
    expect(sql).toContain("release.runtime_gate_status = 'passed'")
    expect(sql).toContain("target_equipment_access <> 'full_gym'")
    expect(sql).toContain("'EQUIPMENT_REVIEW_REQUIRED'")
  })

  it('never derives a prescribed weight from push-up capacity', async () => {
    const sql = await readFile(migrationPath, 'utf8')
    const enrollmentFunction = sql.split(
      'create or replace function public.initialize_current_method_enrollment()',
    )[1]?.split('create or replace function public.complete_phase2_onboarding')[0]

    expect(enrollmentFunction).toBeTruthy()
    expect(enrollmentFunction).not.toContain('pushup_capacity')
    expect(enrollmentFunction).not.toContain('reference_weight_kg')
  })
})
