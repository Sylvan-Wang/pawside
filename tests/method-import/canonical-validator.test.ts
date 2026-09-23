import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateCanonicalWorkbook } from '../../scripts/method-import/canonical-validator.ts'
import { readCanonicalWorkbook } from '../../scripts/method-import/workbook-reader.mts'

const v12Path = path.resolve(
  'outputs/method-p0-resolution/Pawside_三分化_Canonical_Method_Workbook_v1.2.xlsx',
)

describe('Canonical Workbook v1.2', () => {
  it('passes the V1 runtime gate while keeping Strict Method blocked', async () => {
    const workbook = await readCanonicalWorkbook(v12Path, '1.2')
    const report = validateCanonicalWorkbook(workbook)

    expect(report.valid).toBe(true)
    expect(report.gates.runtime).toBe('passed')
    expect(report.gates.strict).toBe('blocked')
  })

  it('preserves Q-001 and Q-004 as accepted runtime defaults', async () => {
    const workbook = await readCanonicalWorkbook(v12Path, '1.2')
    const report = validateCanonicalWorkbook(workbook)

    for (const issueKey of ['Q-001', 'Q-004']) {
      expect(report.gates.issues).toContainEqual(
        expect.objectContaining({
          issueKey,
          status: 'accepted_runtime_default',
          blocksV1RuntimeRelease: false,
          blocksStrictMethodRelease: true,
        }),
      )
    }
  })

  it('resolves every concrete EvidenceID referenced by runtime sheets', async () => {
    const workbook = await readCanonicalWorkbook(v12Path, '1.2')
    const report = validateCanonicalWorkbook(workbook)

    expect(
      report.findings.filter((finding) => finding.code === 'UNRESOLVED_EVIDENCE'),
    ).toEqual([])
  })
})
