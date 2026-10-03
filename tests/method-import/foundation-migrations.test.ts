import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrations = {
  featureGating: 'supabase/migrations/20261004000100_feature_gating.sql',
  reviewSettings: 'supabase/migrations/20261004000200_review_settings.sql',
  enrollmentGuard: 'supabase/migrations/20261004000300_guard_enrollment_delete.sql',
  exerciseIdentity: 'supabase/migrations/20261004000400_exercise_identity_governance.sql',
  recordShape: 'supabase/migrations/20261004000500_set_record_shape.sql',
  softDelete: 'supabase/migrations/20261004000600_workout_session_soft_delete.sql',
  historyViews: 'supabase/migrations/20261004000700_exercise_history_views.sql',
  splitKeys: 'supabase/migrations/20261004000800_split_key_generalization.sql',
  dayTypes: 'supabase/migrations/20261004000900_split_day_types.sql',
  durationTargets: 'supabase/migrations/20261004001000_prescription_duration_targets.sql',
  sourceAuthority: 'supabase/migrations/20261004001100_source_authority_v2.sql',
  programDayFunctions: 'supabase/migrations/20261004001200_program_day_functions.sql',
  privateVisibility: 'supabase/migrations/20261004001300_private_method_visibility.sql',
  adjustments: 'supabase/migrations/20261004001400_user_method_adjustments.sql',
  cascadeProtection: 'supabase/migrations/20261004001500_cascade_friendly_release_protection.sql',
  goldLibrary: 'supabase/migrations/20261004001600_gold_exercise_library_tables.sql',
  imports: 'supabase/migrations/20261004001700_user_method_imports.sql',
  exerciseResolution: 'supabase/migrations/20261004001800_resolve_or_create_exercise.sql',
  userTextSource: 'supabase/migrations/20261004001900_source_document_user_text.sql',
} as const

describe('method import foundation migrations F1 and F2', () => {
  it('keeps all four feature gates disabled by default and enforces them in the database', async () => {
    const sql = await readFile(migrations.featureGating, 'utf8')
    expect(sql).toContain("('multi_day_runtime'")
    expect(sql).toContain("('method_import'")
    expect(sql).toContain("('adjustments'")
    expect(sql).toContain("('review_hub'")
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
  })

  it('creates owner-only review preferences and read state', async () => {
    const sql = await readFile(migrations.reviewSettings, 'utf8')
    expect(sql).toContain('create table public.user_review_settings')
    expect(sql).toContain('create table public.user_review_reads')
    expect(sql).toContain('force row level security')
  })

  it('guards facts and preserves account deletion semantics', async () => {
    const sql = await readFile(migrations.enrollmentGuard, 'utf8')
    expect(sql).toContain('exists (select 1 from public.workout_sessions')
    expect(sql).toContain('exists (select 1 from auth.users')
    expect(sql).toContain('from public, anon, authenticated')
  })

  it('adds exercise governance without weakening canonical names', async () => {
    const sql = await readFile(migrations.exerciseIdentity, 'utf8')
    expect(sql).toContain('review_status')
    expect(sql).toContain('record_shape')
    expect(sql).toContain('create table public.exercise_redirects')
    expect(sql).not.toContain('drop constraint exercises_canonical_name_zh_key')
  })

  it('adds duration and distance facts before replacing the completed-set constraint', async () => {
    const sql = await readFile(migrations.recordShape, 'utf8')
    expect(sql).toContain('actual_duration_seconds')
    expect(sql).toContain('actual_distance_m')
    expect(sql.indexOf('validate constraint set_executions_completed_has_measure')).toBeLessThan(
      sql.indexOf('drop constraint set_executions_check'),
    )
  })

  it('uses soft deletion and excludes deleted sessions from both history views', async () => {
    const softDelete = await readFile(migrations.softDelete, 'utf8')
    const history = await readFile(migrations.historyViews, 'utf8')
    expect(softDelete).toContain('add column deleted_at timestamptz')
    expect(history).toContain('ws.deleted_at is null')
    expect(history).toContain('security_invoker = true')
  })

  it('generalizes program days while preserving deterministic rotation and names', async () => {
    const splitKeys = await readFile(migrations.splitKeys, 'utf8')
    const dayTypes = await readFile(migrations.dayTypes, 'utf8')
    const functions = await readFile(migrations.programDayFunctions, 'utf8')
    expect(splitKeys.match(/\^\[a-z\]\[a-z0-9_\]/g)?.length).toBe(5)
    expect(dayTypes).toContain("day_type in ('strength', 'core', 'cardio')")
    expect(dayTypes).toContain("'skipped'")
    expect(functions).toContain("prescription.status in ('completed', 'skipped')")
    expect(functions).toContain('order by split.order_index')
    expect(functions).toContain('from public, anon, authenticated')
  })

  it('adds record targets and all imported-value authorities', async () => {
    const targets = await readFile(migrations.durationTargets, 'utf8')
    const authorities = await readFile(migrations.sourceAuthority, 'utf8')
    expect(targets).toContain('alter table public.set_prescriptions')
    expect(targets).toContain('alter table public.method_runtime_set_templates')
    expect(targets).toContain('target_duration_seconds integer')
    expect(targets).toContain('target_distance_m numeric(9,2)')
    expect(authorities).toContain("'library_default', 'ai_inferred', 'user_corrected'")
  })

  it('keeps private methods owner-only and adjustments read-only to clients', async () => {
    const visibility = await readFile(migrations.privateVisibility, 'utf8')
    const adjustments = await readFile(migrations.adjustments, 'utf8')
    const cascade = await readFile(migrations.cascadeProtection, 'utf8')
    expect(visibility).toContain('owner_user_id = (select auth.uid())')
    expect(visibility).toContain('public.method_visible_to_user')
    expect(adjustments).toContain('grant select on table public.user_method_adjustments')
    expect(adjustments).not.toContain('grant insert')
    expect(cascade).toContain('and not exists (select 1 from public.methods')
  })

  it('creates read-only gold data and consented, quota-bound imports', async () => {
    const gold = await readFile(migrations.goldLibrary, 'utf8')
    const imports = await readFile(migrations.imports, 'utf8')
    const resolution = await readFile(migrations.exerciseResolution, 'utf8')
    const userText = await readFile(migrations.userTextSource, 'utf8')
    expect(gold).toContain('create table public.exercise_defaults')
    expect(gold).toContain('grant select on table public.exercise_defaults')
    expect(imports).toContain('consent_version text not null')
    expect(imports).toContain('Import limit reached (5 per 24 hours)')
    expect(imports).toContain("status = 'draft'")
    expect(resolution).toContain('draft_count >= 100')
    expect(resolution).toContain("set search_path = ''")
    expect(userText).toContain("'user_text'")
  })
})
