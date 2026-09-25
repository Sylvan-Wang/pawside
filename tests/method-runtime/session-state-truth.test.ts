import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const todayRoute = readFileSync(new URL('../../app/api/training/today/route.ts', import.meta.url), 'utf8')
const startMigration = readFileSync(new URL('../../supabase/migrations/20260911000200_method_workout_runtime.sql', import.meta.url), 'utf8')
const stateTruthMigration = readFileSync(new URL('../../supabase/migrations/20260925000100_method_runtime_state_truth.sql', import.meta.url), 'utf8')
const navigationMigration = readFileSync(new URL('../../supabase/migrations/20260925000200_training_date_navigation.sql', import.meta.url), 'utf8')
const scopeFixMigration = readFileSync(new URL('../../supabase/migrations/20260925000400_method_completion_variable_scope_fix.sql', import.meta.url), 'utf8')
const repairPlan = readFileSync(new URL('../../docs/internal-beta/runtime-history-repair-plan.md', import.meta.url), 'utf8')

describe('Method runtime state truth', () => {
  it('keeps viewing read-only and restores an unfinished actual before a newer prescription', () => {
    expect(todayRoute).toContain(".eq('status', 'started')")
    expect(todayRoute).toContain("recovery: activeSession ? { kind: 'active_session'")
    expect(todayRoute).not.toContain("rpc('start_method_session'")
    expect(todayRoute).not.toContain("rpc('complete_method_session")
  })

  it('starts explicitly without advancing split or cycle', () => {
    const startFunction = startMigration.split('create or replace function public.start_method_session')[1]
      .split('create or replace function public.save_method_set_actual')[0]
    expect(startFunction).toContain("set current_state = 'session_in_progress'")
    expect(startFunction).not.toContain('current_cycle_number = current_cycle_number + 1')
    expect(startFunction).not.toContain('set next_split_key =')
  })

  it('never lets an additive migration replace the released completion gate', () => {
    // STRUCTURAL GUARANTEE: public.complete_method_session(uuid, integer, text) is
    // defined exactly once, in the released migration. Neither new migration may
    // redefine it, so the released caller cannot be silently changed.
    expect(stateTruthMigration).not.toContain('create or replace function public.complete_method_session(')
    expect(navigationMigration).not.toContain('create or replace function public.complete_method_session(')
    // The new policy therefore lives only in the *_v2 name.
    expect(navigationMigration).toContain('create or replace function public.complete_method_session_v2(')
  })

  it('completes a Program Day on the Minimum P1 exercise-count threshold', () => {
    expect(navigationMigration).toContain('exercise_count_threshold_v1')
    expect(navigationMigration).toContain('completed_exercise_count < required_exercise_count')
    // Minimum P1 §6: remaining exercises are left alone and never forced skipped.
    expect(navigationMigration).not.toContain("set status = 'skipped'")
    expect(navigationMigration).not.toContain('incomplete_exercise_count')
    expect(navigationMigration).not.toContain('Every prescribed exercise')
  })

  it('keeps the effective completion function free of variable/column ambiguity', () => {
    // 20260925000200 was already applied when `supabase db lint --linked`
    // (plpgsql_check) reported SQLSTATE 42702 for
    // `completed_exercise_count = completed_exercise_count`, so the correction is
    // recorded forward in 20260925000400.
    // Only executable SQL matters; the file header documents the old line in a comment.
    const scopeFixSql = scopeFixMigration
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')

    expect(scopeFixMigration).toContain('create or replace function public.complete_method_session_v2(')
    expect(scopeFixSql).toContain('completed_exercise_count = completed_count')
    expect(scopeFixSql).toContain('completed_count < required_exercise_count')
    expect(scopeFixSql).not.toContain('completed_exercise_count = completed_exercise_count')
    // The response key and stored column must not be renamed.
    expect(scopeFixSql).toContain("'completed_exercise_count', completed_count")
    expect(scopeFixSql).toContain("'exercise_count_threshold_v1'")
    // It must not touch the released completion function.
    expect(scopeFixSql).not.toContain('function public.complete_method_session(')
  })

  it('advances a fully recorded session once and deduplicates retries', () => {
    expect(navigationMigration).toContain('p_completion_request_id uuid')
    expect(stateTruthMigration).toContain('workout_sessions_completion_request_idx')
    expect(navigationMigration).toContain("target_session.status = 'completed'")
    expect(navigationMigration).toContain("'idempotent', true")
  })

  it('keeps historical repair scoped, dry-run first, and non-bulk', () => {
    expect(repairPlan).toContain('明确的 session_id')
    expect(repairPlan).toContain('dry-run')
    expect(repairPlan).toContain('自动 HOLD')
    expect(repairPlan).toContain('禁止按用户、日期或状态做批量 UPDATE')
    expect(repairPlan).toContain('不执行任何历史数据修改')
  })
})
