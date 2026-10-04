import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('monthly review AI surface migration', () => {
  it('extends the generation surface constraint append-only', () => {
    const sql = readFileSync('supabase/migrations/20261004002900_ai_generation_monthly_review.sql', 'utf8')
    expect(sql).toContain("'monthly_review'")
    expect(sql).toContain('add constraint ai_generations_surface_v3_check')
    expect(sql).toContain('drop constraint ai_generations_surface_v2_check')
  })
})
