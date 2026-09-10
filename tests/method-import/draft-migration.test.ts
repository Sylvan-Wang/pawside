import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260909000600_method_v1_2_validated_draft.sql'

describe('Canonical Method v1.2 draft migration', () => {
  it('creates a validated internal-beta release without activation', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain("'validated'")
    expect(sql).toContain("'internal_beta'")
    expect(sql).toContain("'passed'")
    expect(sql).toContain("'blocked'")
    expect(sql).not.toMatch(/\bstatus\s*=\s*'active'/)
    expect(sql).not.toMatch(/insert\s+into\s+public\.method_enrollments/i)
  })

  it('preserves the immutable workbook identity and double gate', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain(
      '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd',
    )
    expect(sql).toContain("'Q-001'")
    expect(sql).toContain("'Q-004'")
    expect(sql).toContain('blocks_v1_runtime_release')
    expect(sql).toContain('blocks_strict_method_release')
  })

  it('seeds exactly fifteen plan rows and calibration-only P0 progression', async () => {
    const sql = await readFile(migrationPath, 'utf8')
    const catalogBlock = sql.match(/catalog jsonb := '(\[[\s\S]*?\])'::jsonb;/)?.[1]

    expect(catalogBlock).toBeTruthy()
    expect(JSON.parse(catalogBlock as string)).toHaveLength(15)
    expect(sql).toContain('"type":"calibration_only","method_stage":null')
    expect(sql).not.toMatch(/"method_stage"\s*:\s*"[^"]+"/)
  })
})
