import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('nutrition target privilege correction', () => {
  it('lets the existing own-row RLS policy receive authenticated operations', () => {
    const sql = readFileSync('supabase/migrations/20261004003100_fix_nutrition_target_privileges.sql', 'utf8')
    expect(sql).toContain('grant select, insert, update, delete')
    expect(sql).toContain('to authenticated')
    expect(sql).toContain('public.body_metric_write_receipts')
    expect(sql).not.toContain('to anon')
  })
})
