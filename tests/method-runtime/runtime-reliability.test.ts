import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { trainingExerciseActionSchema } from '../../lib/contracts/training-exercise-action'

const migration = readFileSync(
  new URL('../../supabase/migrations/20260924000100_method_runtime_reliability.sql', import.meta.url),
  'utf8',
)
const page = readFileSync(
  new URL('../../app/training/sessions/[sessionId]/page.tsx', import.meta.url),
  'utf8',
)
const queue = readFileSync(
  new URL('../../lib/training-offline-queue.ts', import.meta.url),
  'utf8',
)

describe('Method runtime reliability', () => {
  it('supports explicit skip and resume through an owned active session', () => {
    expect(migration).toContain('create or replace function public.set_method_exercise_status')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain("p_action not in ('skip', 'resume')")
    expect(migration).toContain('Exercise with completed sets cannot be skipped')
    expect(trainingExerciseActionSchema.safeParse({ action: 'skip' }).success).toBe(true)
    expect(trainingExerciseActionSchema.safeParse({ action: 'later' }).success).toBe(false)
  })

  it('marks changed actuals pending and records an append-only revision', () => {
    expect(migration).toContain("downstream_status = 'pending'")
    expect(migration).toContain('actual_revision = actual_revision + 1')
    expect(migration).toContain('create table public.method_actual_change_events')
    expect(migration).toContain("old.actual_weight_kg is not distinct from new.actual_weight_kg")
  })

  it('keeps offline actuals scoped to the current user and retries on reconnect', () => {
    expect(queue).toContain("item.userId === userId && item.sessionId === sessionId")
    expect(queue).toContain('exercise_execution_id')
    expect(page).toContain("window.addEventListener('online', retry)")
    expect(page).toContain('已暂存在本机，联网后会自动同步')
    expect(page).toContain('仍有训练记录等待联网同步')
  })

  it('shows separate later and skip actions', () => {
    expect(page).toContain('稍后做')
    expect(page).toContain('跳过动作')
    expect(page).toContain('恢复这个动作')
  })
})
