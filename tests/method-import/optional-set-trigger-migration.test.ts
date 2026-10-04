import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('optional set release join correction', () => {
  it('resolves the release through method_splits instead of a missing prescription column', () => {
    const sql = readFileSync('supabase/migrations/20261004003000_fix_optional_set_release_join.sql', 'utf8')
    expect(sql).toContain('split.method_release_id')
    expect(sql).not.toContain('sp.method_release_id')
    expect(sql).toContain('create or replace function public.copy_runtime_set_optional_flag()')
  })
})
