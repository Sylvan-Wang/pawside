import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * O-24 — the target snapshot already recorded for a date is the provenance of
 * record. A correction of the same day's body metric must not move the bar the
 * day was scored against, otherwise `profile_target_runtime_contract.sql`
 * (which fails on a clean database, and therefore in CI) cannot pass.
 */
describe('target snapshot first-write-wins correction', () => {
  const sql = readFileSync(
    'supabase/migrations/20261004003200_target_snapshot_first_write_wins.sql',
    'utf8',
  )

  it('replaces the body-metric writer without touching any earlier migration', () => {
    expect(sql).toContain('create or replace function public.save_body_metric_with_target_v1(')
    expect(sql).toContain('grant execute on function public.save_body_metric_with_target_v1')
    expect(sql).toContain('to authenticated')
  })

  it('looks the recorded target up before persisting a new one', () => {
    const lookup = sql.indexOf('select id into target_id')
    const persist = sql.indexOf('target_id := public.persist_nutrition_target_snapshot_v1(')
    expect(lookup).toBeGreaterThan(-1)
    expect(persist).toBeGreaterThan(lookup)
    expect(sql).toContain("where user_id = current_user_id and effective_date = p_target_effective_date")
  })

  it('keeps the snapshot inside the conditional instead of upserting it every write', () => {
    const guard = sql.slice(sql.indexOf('if target_id is null then'))
    expect(guard).toContain('target_id := public.persist_nutrition_target_snapshot_v1(')
    expect(sql).not.toContain('on conflict (user_id, effective_date) do update')
  })

  it('still records the metric and the immutable request receipt', () => {
    expect(sql).toContain('insert into public.body_metrics (')
    expect(sql).toContain('insert into public.body_metric_write_receipts (user_id, request_id, body_metric_id)')
    expect(sql).toContain("'idempotent', true")
    expect(sql).toContain("'idempotent', false")
  })
})
