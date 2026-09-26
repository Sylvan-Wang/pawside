import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { requiredExerciseCount, isSessionMinutes, SESSION_MINUTE_OPTIONS, effectiveRequiredExerciseCount } from '../../lib/training-duration'
import { startTrainingSessionSchema, updateTrainingDurationSchema } from '../../lib/contracts/training-runtime'

const navigationMigration = readFileSync(
  new URL('../../supabase/migrations/20260925000200_training_date_navigation.sql', import.meta.url),
  'utf8',
)
const programDayMigration = readFileSync(
  new URL('../../supabase/migrations/20260925000300_program_day_prescriptions.sql', import.meta.url),
  'utf8',
)
const stateTruthMigration = readFileSync(
  new URL('../../supabase/migrations/20260925000100_method_runtime_state_truth.sql', import.meta.url),
  'utf8',
)
const hardeningMigration = readFileSync(
  new URL('../../supabase/migrations/20260925000500_training_runtime_truth_hardening.sql', import.meta.url),
  'utf8',
)
const startRoute = readFileSync(
  new URL('../../app/api/training/[prescriptionId]/start/route.ts', import.meta.url),
  'utf8',
)
const durationRoute = readFileSync(
  new URL('../../app/api/training/sessions/[sessionId]/duration/route.ts', import.meta.url),
  'utf8',
)
const completeRoute = readFileSync(
  new URL('../../app/api/training/sessions/[sessionId]/complete/route.ts', import.meta.url),
  'utf8',
)
const sessionRoute = readFileSync(
  new URL('../../app/api/training/sessions/[sessionId]/route.ts', import.meta.url),
  'utf8',
)
const sessionPage = readFileSync(
  new URL('../../app/training/sessions/[sessionId]/page.tsx', import.meta.url),
  'utf8',
)
const todayPage = readFileSync(
  new URL('../../app/training/today/page.tsx', import.meta.url),
  'utf8',
)
const homePage = readFileSync(new URL('../../app/home/page.tsx', import.meta.url), 'utf8')

describe('Minimum P1 duration selection', () => {
  it('offers only 30/45/60/90 everywhere', () => {
    expect([...SESSION_MINUTE_OPTIONS]).toEqual([30, 45, 60, 90])
    for (const minutes of [30, 45, 60, 90] as const) expect(isSessionMinutes(minutes)).toBe(true)
    expect(isSessionMinutes(75)).toBe(false)
    expect(isSessionMinutes('30')).toBe(false)
  })

  it('derives the 5-exercise thresholds as 3/4/5/5', () => {
    expect(requiredExerciseCount(5, 30)).toBe(3)
    expect(requiredExerciseCount(5, 45)).toBe(4)
    expect(requiredExerciseCount(5, 60)).toBe(5)
    expect(requiredExerciseCount(5, 90)).toBe(5)
  })

  it('never lets 90 minutes add work, and never exceeds the prescription', () => {
    expect(requiredExerciseCount(5, 90)).toBe(5)
    expect(requiredExerciseCount(3, 90)).toBe(3)
    expect(requiredExerciseCount(0, 30)).toBe(0)
  })

  it('keeps the onboarding preference untouched by a session override', () => {
    // The selected duration is a session snapshot column, never a write back to
    // onboarding_capability_profiles.
    expect(stateTruthMigration).toContain('selected_session_minutes')
    expect(navigationMigration).not.toContain('update public.onboarding_capability_profiles')
    expect(navigationMigration).not.toContain('preferred_session_minutes =')
  })
})

describe('Minimum P1 API wiring', () => {
  it('accepts an optional duration choice on start and re-validates server side', () => {
    expect(startTrainingSessionSchema.safeParse({
      view_date: '2026-09-25',
      time_zone: 'Asia/Shanghai',
      start_request_id: '00000000-0000-4000-8000-000000000001',
      selected_session_minutes: 45,
      selection_source: 'user_override',
    }).success).toBe(true)
    // Omitted duration stays valid: the server resolves the fallback chain.
    expect(startTrainingSessionSchema.safeParse({
      view_date: '2026-09-25',
      time_zone: 'Asia/Shanghai',
      start_request_id: '00000000-0000-4000-8000-000000000001',
    }).success).toBe(true)
    expect(startTrainingSessionSchema.safeParse({
      view_date: '2026-09-25',
      time_zone: 'Asia/Shanghai',
      start_request_id: '00000000-0000-4000-8000-000000000001',
      selected_session_minutes: 75,
    }).success).toBe(false)
    expect(startRoute).toContain('p_selected_session_minutes')
    expect(startRoute).toContain("rpc('start_method_session_v3'")
    expect(navigationMigration).toContain('coalesce(preferred_minutes, 60)')
  })

  it('exposes the mid-session duration change as a PATCH on an active session', () => {
    expect(updateTrainingDurationSchema.safeParse({
      selected_session_minutes: 30,
      selection_source: 'mid_session_change',
    }).success).toBe(true)
    expect(updateTrainingDurationSchema.safeParse({
      selected_session_minutes: 75,
      selection_source: 'mid_session_change',
    }).success).toBe(false)
    expect(durationRoute).toContain('export async function PATCH')
    expect(durationRoute).toContain("rpc('update_method_session_duration'")
    expect(hardeningMigration).toContain('create or replace function public.update_method_session_duration(')
    expect(hardeningMigration).toContain('Duration can only be shortened')
  })

  it('routes completion and the session read through the v2 runtime truth', () => {
    expect(completeRoute).toContain("rpc('complete_method_session_v2'")
    expect(sessionRoute).toContain('fully_completed')
    expect(sessionRoute).toContain('required_exercise_count')
    expect(sessionRoute).toContain('can_complete')
  })

  it('materialises Program Days idempotently without advancing anything', () => {
    expect(programDayMigration).toContain('create or replace function public.create_program_day_prescription(')
    // Idempotent: an existing Day of the cycle is returned, never regenerated.
    expect(programDayMigration).toContain('if existing_prescription_id is not null then return existing_prescription_id; end if;')
    // Pure materialisation: no progression side effects.
    expect(programDayMigration).not.toContain('set next_split_key =')
    expect(programDayMigration).not.toContain("set status = 'completed'")
    expect(programDayMigration).not.toContain('current_cycle_number = current_cycle_number + 1')
  })
})

describe('Minimum P1 Program Day recomputation', () => {
  it('recomputes next_split_key from the cycle ledger (PRD §10)', () => {
    expect(navigationMigration).toContain('candidate.split_key')
    expect(navigationMigration).toContain('prescription.status = \'completed\'')
    expect(navigationMigration).toContain('order by candidate.ord')
    // The mechanical successor must be gone from the v2 completion path.
    expect(navigationMigration).not.toContain("when 'push' then 'pull' else 'legs' end")
  })

  it('closes a cycle only when all three Program Days are completed', () => {
    const completionFunction = navigationMigration
      .split('create or replace function public.complete_method_session_v2(')[1]
      .split('revoke all on function public.complete_method_session_v2')[0]
    expect(completionFunction).toContain('if next_split is null then')
    expect(completionFunction).toContain('cycle_finished := true')
    expect(completionFunction).toContain('current_cycle_number = current_cycle_number + 1')
    // Cycle closure must happen strictly after the earliest-incomplete lookup.
    expect(completionFunction.indexOf('select candidate.split_key into next_split'))
      .toBeLessThan(completionFunction.indexOf('current_cycle_number = current_cycle_number + 1'))
  })
})

describe('Minimum P1 session completion eligibility', () => {
  it('applies the snapshot threshold to a canonical Program Day execution', () => {
    expect(effectiveRequiredExerciseCount({
      executionMode: 'canonical',
      originalExerciseCount: 5,
      snapshotRequiredExerciseCount: 3,
      selectedSessionMinutes: 30,
    })).toBe(3)
  })

  it('never makes a replay or supplemental execution un-completable', () => {
    // PRD §11.2 / §12: these never complete or advance a Program Day, so they keep
    // the released "at least one" floor instead of the Program Day threshold.
    for (const mode of ['replay', 'supplemental'] as const) {
      expect(effectiveRequiredExerciseCount({
        executionMode: mode,
        originalExerciseCount: 5,
        snapshotRequiredExerciseCount: 5,
        selectedSessionMinutes: 60,
      })).toBe(1)
    }
  })

  it('keeps the released floor for sessions started before Minimum P1', () => {
    expect(effectiveRequiredExerciseCount({
      executionMode: 'canonical',
      originalExerciseCount: 5,
      snapshotRequiredExerciseCount: null,
      selectedSessionMinutes: null,
    })).toBe(1)
  })

  it('falls back to the formula when a snapshot is missing but a duration exists', () => {
    expect(effectiveRequiredExerciseCount({
      executionMode: 'canonical',
      originalExerciseCount: 5,
      snapshotRequiredExerciseCount: null,
      selectedSessionMinutes: 30,
    })).toBe(3)
  })

  it('never exceeds the prescribed exercise count', () => {
    expect(effectiveRequiredExerciseCount({
      executionMode: 'canonical',
      originalExerciseCount: 3,
      snapshotRequiredExerciseCount: 5,
      selectedSessionMinutes: 90,
    })).toBe(3)
    expect(effectiveRequiredExerciseCount({
      executionMode: 'canonical',
      originalExerciseCount: 0,
      snapshotRequiredExerciseCount: null,
      selectedSessionMinutes: 30,
    })).toBe(0)
  })

  it('is mirrored by the SQL gate', () => {
    expect(hardeningMigration).toContain("target_session.execution_mode in ('replay', 'supplemental')")
    expect(hardeningMigration).toContain("then 'supplemental_actual_v1'")
    expect(hardeningMigration).toContain('completed_set_count < 1')
    expect(hardeningMigration).toContain('At least one persisted set actual is required')
    expect(hardeningMigration).toContain('completion_count_unit')
  })
})

describe('Minimum P1 UI contract', () => {
  it('shows the exercise-count threshold and never frames it as debt (PRD §13.2)', () => {
    expect(sessionPage).toContain('完成任意')
    expect(sessionPage).toContain('今天的训练已达成')
    expect(sessionPage).toContain('结束今天训练')
    for (const banned of ['你还欠', '未完成完整版', '补作业', '训练不完整']) {
      expect(sessionPage).not.toContain(banned)
    }
    // Remaining work is explicitly allowed to stay undone.
    expect(sessionPage).toContain('不做也不会影响这个训练日')
  })

  it('offers the duration choice before starting and while training', () => {
    expect(todayPage).toContain('今天大概想练多久？')
    expect(todayPage).toContain('SESSION_MINUTE_OPTIONS.map')
    expect(todayPage).toContain('preferred_session_minutes')
    expect(todayPage).toContain('实际用时会受休息和器械等待影响')
    expect(sessionPage).toContain('aria-label="调整本次训练时长"')
    expect(sessionPage).toContain('changeDuration')
  })

  it('does not label individual exercises as required or optional (PRD §13.1)', () => {
    expect(sessionPage).not.toContain('Required')
    expect(sessionPage).not.toContain('Optional')
    expect(sessionPage).not.toContain('可删动作')
    expect(sessionPage).not.toContain('核心动作')
  })

  it('caches by Program Day rather than calendar date', () => {
    expect(homePage).toContain('program_day?.split_key')
    expect(todayPage).toContain('writeTodayTrainingCache(data, data.program_day.split_key)')
  })
})
