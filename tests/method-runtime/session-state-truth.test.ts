import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const todayRoute = readFileSync(new URL('../../app/api/training/today/route.ts', import.meta.url), 'utf8')
const startMigration = readFileSync(new URL('../../supabase/migrations/20260911000200_method_workout_runtime.sql', import.meta.url), 'utf8')
const truthMigration = readFileSync(new URL('../../supabase/migrations/20260925000100_method_runtime_state_truth.sql', import.meta.url), 'utf8')
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

  it('does not advance a partial or skipped session', () => {
    expect(truthMigration).toContain("execution.status = 'skipped'")
    expect(truthMigration).toContain('incomplete_exercise_count > 0')
    expect(truthMigration).toContain('Every prescribed exercise requires at least one completed set')
    expect(truthMigration.indexOf('incomplete_exercise_count > 0')).toBeLessThan(
      truthMigration.indexOf('set current_cycle_number = current_cycle_number + 1'),
    )
  })

  it('advances a fully recorded session once and deduplicates retries', () => {
    expect(truthMigration).toContain('p_completion_request_id uuid')
    expect(truthMigration).toContain('workout_sessions_completion_request_idx')
    expect(truthMigration).toContain("target_session.status = 'completed'")
    expect(truthMigration).toContain("'idempotent', true")
    expect(truthMigration).toContain("completion_rule_version = 'all_exercises_v1'")
  })

  it('keeps historical repair scoped, dry-run first, and non-bulk', () => {
    expect(repairPlan).toContain('明确的 session_id')
    expect(repairPlan).toContain('dry-run')
    expect(repairPlan).toContain('自动 HOLD')
    expect(repairPlan).toContain('禁止按用户、日期或状态做批量 UPDATE')
    expect(repairPlan).toContain('不执行任何历史数据修改')
  })
})
