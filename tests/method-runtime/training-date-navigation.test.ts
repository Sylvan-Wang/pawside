import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../../app/training/today/page.tsx', import.meta.url), 'utf8')
const todayRoute = readFileSync(new URL('../../app/api/training/today/route.ts', import.meta.url), 'utf8')
const startRoute = readFileSync(new URL('../../app/api/training/[prescriptionId]/start/route.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260925000200_training_date_navigation.sql', import.meta.url), 'utf8')
const cutover = readFileSync(new URL('../../supabase/cutover/20260926000100_drop_prescription_uniqueness.sql', import.meta.url), 'utf8')

describe('training date navigation and attribution', () => {
  it('navigates Program Days instead of calendar dates (PRD §2.1)', () => {
    expect(page).toContain('aria-label="训练日导航"')
    expect(page).toContain('Day {day.day_index} · {day.name_zh}')
    expect(page).toContain('selectDay(day.split_key)')
    // The superseded calendar-day navigation must be gone.
    expect(page).not.toContain('上一天')
    expect(page).not.toContain('下一天')
  })

  it('resolves the Program Day independently from the calendar date (PRD §1)', () => {
    expect(todayRoute).toContain("url.searchParams.get('split')")
    expect(todayRoute).toContain('PROGRAM_DAY_ORDER')
    expect(todayRoute).not.toContain("eq('planned_for_date', effectiveViewDate)")
  })

  it('passes view date and browser time zone without treating view date as log date', () => {
    expect(startRoute).toContain('p_view_date: parsed.data.view_date')
    expect(startRoute).toContain('p_time_zone: parsed.data.time_zone')
    expect(migration).toContain('(execution_time at time zone p_time_zone)::date')
    expect(migration).toContain("'started', p_view_date, execution_time, p_time_zone, derived_log_date")
  })

  it('decides canonical/supplemental from Program Day completion, not the date', () => {
    expect(migration).toContain("then 'supplemental'")
    expect(migration).toContain("then 'canonical'")
    expect(migration).not.toContain('view_date <> ')
  })

  it('keeps the destructive uniqueness cutover out of the additive migrations', () => {
    // PRD-era migrations must stay safe to apply on their own.
    expect(migration).not.toContain('drop constraint if exists workout_sessions_session_prescription_id_key')
    expect(cutover).toContain('drop constraint if exists workout_sessions_session_prescription_id_key')
    // ...and the app must stop assuming one session per prescription.
    expect(todayRoute).not.toContain('.eq(\'session_prescription_id\', activeSession.session_prescription_id)')
    expect(todayRoute).toContain('Never assume one session per prescription')
  })

  it('attributes legacy history to the derived execution log date', () => {
    expect(migration).toContain('current_user_id, target_session.log_date')
    expect(migration).not.toContain('current_user_id, current_date')
  })
})
