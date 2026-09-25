import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../../app/training/today/page.tsx', import.meta.url), 'utf8')
const todayRoute = readFileSync(new URL('../../app/api/training/today/route.ts', import.meta.url), 'utf8')
const startRoute = readFileSync(new URL('../../app/api/training/[prescriptionId]/start/route.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260925000200_training_date_navigation.sql', import.meta.url), 'utf8')

describe('training date navigation and attribution', () => {
  it('offers previous and next day navigation and queries the selected plan date', () => {
    expect(page).toContain('上一天')
    expect(page).toContain('下一天')
    expect(page).toContain('navigateDate(shiftDate(viewDate, -1))')
    expect(todayRoute).toContain(".eq('planned_for_date', effectiveViewDate)")
  })

  it('passes view date and browser time zone without treating view date as log date', () => {
    expect(startRoute).toContain('p_view_date: parsed.data.view_date')
    expect(startRoute).toContain('p_time_zone: parsed.data.time_zone')
    expect(migration).toContain('(execution_time at time zone p_time_zone)::date')
    expect(migration).toContain("'started', p_view_date, execution_time, p_time_zone, derived_log_date")
  })

  it('creates append-only replay sessions for already used historical prescriptions', () => {
    expect(migration).toContain('drop constraint if exists workout_sessions_session_prescription_id_key')
    expect(migration).toContain("then 'canonical' else 'replay' end")
    expect(migration).toContain("target_session.execution_mode = 'replay'")
    expect(migration).toContain("'progression_advanced', false")
  })

  it('attributes legacy history to the derived execution log date', () => {
    expect(migration).toContain('current_user_id, target_session.log_date')
    expect(migration).not.toContain('current_user_id, current_date')
  })
})
