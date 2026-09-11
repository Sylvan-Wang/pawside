import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completeTrainingSessionSchema, saveSetActualSchema } from '../../lib/contracts/training-runtime'

const sql = readFileSync(
  new URL('../../supabase/migrations/20260911000200_method_workout_runtime.sql', import.meta.url),
  'utf8',
)

describe('Method workout runtime migration', () => {
  it('keeps prescription and actual in separate normalized tables', () => {
    expect(sql).toContain('create table public.workout_sessions')
    expect(sql).toContain('create table public.exercise_executions')
    expect(sql).toContain('create table public.set_executions')
    expect(sql).toContain('session_prescription_id uuid not null unique')
  })

  it('locks and advances the official split order transactionally', () => {
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain("when 'push' then 'pull' else 'legs' end")
    expect(sql).toContain("target_session.split_key = 'legs'")
    expect(sql).toContain("next_split_key = 'push'")
    expect(sql).toContain("values (target_session.enrollment_id, next_cycle_number, 'in_progress')")
  })

  it('is idempotent and links a Method actual to legacy history once', () => {
    expect(sql).toContain("target_session.status = 'completed'")
    expect(sql).toContain("'idempotent', true")
    expect(sql).toContain('method_workout_session_id uuid unique')
    expect(sql).toContain('on conflict (method_workout_session_id) do nothing')
  })

  it('does not expose direct writes to normalized actual tables', () => {
    expect(sql).toContain('force row level security')
    expect(sql).toContain('from anon, authenticated')
    expect(sql).toContain('grant select on table public.workout_sessions')
  })
})

describe('training runtime input contracts', () => {
  it('accepts a low-friction completed set', () => {
    expect(saveSetActualSchema.safeParse({
      exercise_execution_id: '00000000-0000-4000-8000-000000000001',
      set_index: 1,
      actual_weight_kg: 60,
      actual_reps: 8,
      actual_rir: 2,
    }).success).toBe(true)
  })

  it('rejects impossible or unbounded actuals', () => {
    expect(saveSetActualSchema.safeParse({
      exercise_execution_id: 'not-a-uuid',
      set_index: 0,
      actual_reps: -1,
      actual_rir: 21,
    }).success).toBe(false)
  })

  it('bounds session completion metadata', () => {
    expect(completeTrainingSessionSchema.safeParse({ duration_minutes: 60, notes: '状态正常' }).success).toBe(true)
    expect(completeTrainingSessionSchema.safeParse({ duration_minutes: 0 }).success).toBe(false)
  })
})
