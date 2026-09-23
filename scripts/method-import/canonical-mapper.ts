import type {
  CanonicalValidationReport,
  CanonicalWorkbook,
} from '../../lib/contracts/method/canonical-import.ts'
import { P0_RUNTIME_DEFAULTS } from '../../lib/contracts/method/runtime-defaults.ts'
import { RUNTIME_CANONICAL_SHEETS } from './sheet-registry.ts'

export function buildReleaseManifest(
  workbook: CanonicalWorkbook,
  report: CanonicalValidationReport,
) {
  const canonicalRows = Object.fromEntries(
    RUNTIME_CANONICAL_SHEETS.map((sheetName) => {
      const rows = workbook.sheets[sheetName]?.rows ?? []
      return [
        sheetName,
        rows.filter((row) => {
          const importStatus = typeof row['可导入'] === 'string' ? row['可导入'] : ''
          const canonicalStatus =
            typeof row['Canonical状态'] === 'string'
              ? row['Canonical状态']
              : typeof row['状态'] === 'string'
                ? row['状态']
                : ''
          return importStatus === '是' && canonicalStatus !== '待补证据'
        }),
      ]
    }),
  )

  return {
    schemaVersion: 1,
    methodKey: 'ksw_tcy_three_split_2026',
    releaseVersion: workbook.workbookVersion,
    releaseChannel: 'internal_beta',
    releasePolicy: 'v1_runtime',
    proposedStatus:
      report.valid && report.gates.runtime === 'passed' ? 'validated' : 'blocked',
    workbookChecksumSha256: workbook.checksumSha256,
    importerVersion: report.importerVersion,
    gates: report.gates,
    p0RuntimeDefaults: P0_RUNTIME_DEFAULTS,
    canonicalRows,
  }
}
