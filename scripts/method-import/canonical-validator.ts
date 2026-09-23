import type {
  CanonicalValidationReport,
  CanonicalWorkbook,
} from '../../lib/contracts/method/canonical-import.ts'
import type { ReleaseIssue } from '../../lib/contracts/method/release.ts'
import { P0_RUNTIME_DEFAULTS } from '../../lib/contracts/method/runtime-defaults.ts'
import {
  REQUIRED_HEADERS,
  RUNTIME_CANONICAL_SHEETS,
  SHEET_REGISTRY,
} from './sheet-registry.ts'

export const IMPORTER_VERSION = '1.0.0'

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const rowNumber = (row: Record<string, unknown>) =>
  typeof row.__rowNumber === 'number' ? row.__rowNumber : null

function parseReleaseIssue(row: Record<string, unknown>): ReleaseIssue | null {
  const issueKey = text(row.IssueID)
  if (!issueKey) return null

  const blocker = text(row['是否阻塞发布'])
  const statusText = text(row['状态'])
  const resolved = statusText.includes('已解决') && !statusText.includes('仍开放')
  const acceptedRuntimeDefault =
    statusText.includes('Runtime已解决') ||
    statusText.includes('Runtime 已解决') ||
    blocker.includes('V1 Runtime=否')

  const legacyBlocksRelease = blocker === '是'
  const blocksV1RuntimeRelease =
    blocker.includes('V1 Runtime=是') ||
    (legacyBlocksRelease && !resolved && !acceptedRuntimeDefault)
  const blocksStrictMethodRelease =
    blocker.includes('Strict Method=是') ||
    statusText.includes('Strict Source仍开放') ||
    statusText.includes('Strict Source 仍开放') ||
    (legacyBlocksRelease && !resolved)

  return {
    issueKey,
    scope: text(row['范围']) || 'unknown',
    status: resolved
      ? 'resolved'
      : acceptedRuntimeDefault
        ? 'accepted_runtime_default'
        : 'open',
    blocksV1RuntimeRelease,
    blocksStrictMethodRelease,
    sourceNote: text(row['备注']) || null,
  }
}

export function validateCanonicalWorkbook(
  workbook: CanonicalWorkbook,
): CanonicalValidationReport {
  const findings: CanonicalValidationReport['findings'] = []

  for (const expectedSheet of SHEET_REGISTRY) {
    if (!workbook.sheets[expectedSheet]) {
      findings.push({
        severity: 'error',
        code: 'MISSING_SHEET',
        message: 'Missing required sheet: ' + expectedSheet,
        sheet: expectedSheet,
        row: null,
      })
    }
  }

  for (const [sheetName, requiredHeaders] of Object.entries(REQUIRED_HEADERS)) {
    const sheet = workbook.sheets[sheetName]
    if (!sheet) continue
    for (const header of requiredHeaders) {
      if (!sheet.headers.includes(header)) {
        findings.push({
          severity: 'error',
          code: 'MISSING_HEADER',
          message: 'Missing required header: ' + header,
          sheet: sheetName,
          row: sheet.headerRow,
        })
      }
    }
  }

  const evidenceRows = workbook.sheets['14_规则证据索引']?.rows ?? []
  const evidenceKeys = new Set(evidenceRows.map((row) => text(row.EvidenceID)).filter(Boolean))

  for (const sheetName of RUNTIME_CANONICAL_SHEETS) {
    if (sheetName === '14_规则证据索引') continue
    const sheet = workbook.sheets[sheetName]
    if (!sheet) continue

    for (const row of sheet.rows) {
      const references = text(row.EvidenceID).match(/EV-[A-Z0-9-]+/g) ?? []
      for (const reference of references) {
        if (!evidenceKeys.has(reference)) {
          findings.push({
            severity: 'error',
            code: 'UNRESOLVED_EVIDENCE',
            message: 'Evidence reference ' + reference + ' does not exist in 14_规则证据索引',
            sheet: sheetName,
            row: rowNumber(row),
          })
        }
      }
    }
  }

  const planRows = workbook.sheets['03_计划结构']?.rows ?? []
  for (const prescription of P0_RUNTIME_DEFAULTS) {
    const row = planRows.find(
      (candidate) => text(candidate['Canonical建议']) === prescription.canonicalNameZh,
    )
    if (!row) {
      findings.push({
        severity: 'error',
        code: 'P0_RUNTIME_DEFAULT_MISSING',
        message: 'Missing P0 runtime prescription row for ' + prescription.canonicalNameZh,
        sheet: '03_计划结构',
        row: null,
      })
      continue
    }

    const authority = text(row['运行时权威'])
    if (
      prescription.reps.authority === 'product_execution_default' &&
      !authority.includes('product_execution_default')
    ) {
      findings.push({
        severity: 'error',
        code: 'P0_AUTHORITY_MISMATCH',
        message: prescription.canonicalNameZh + ' must preserve product_execution_default provenance',
        sheet: '03_计划结构',
        row: rowNumber(row),
      })
    }
  }

  const issues = (workbook.sheets['18_未决问题']?.rows ?? [])
    .map(parseReleaseIssue)
    .filter((issue): issue is ReleaseIssue => issue !== null)

  const runtimeBlocked = issues.some(
    (issue) => issue.status !== 'resolved' && issue.blocksV1RuntimeRelease,
  )
  const strictBlocked = issues.some(
    (issue) => issue.status !== 'resolved' && issue.blocksStrictMethodRelease,
  )

  const rowCounts = Object.fromEntries(
    Object.entries(workbook.sheets).map(([name, sheet]) => [name, sheet.rows.length]),
  )

  return {
    importerVersion: IMPORTER_VERSION,
    workbookVersion: workbook.workbookVersion,
    workbookChecksumSha256: workbook.checksumSha256,
    valid: !findings.some((finding) => finding.severity === 'error'),
    rowCounts,
    gates: {
      runtime: runtimeBlocked ? 'blocked' : 'passed',
      strict: strictBlocked ? 'blocked' : 'passed',
      issues,
    },
    findings,
  }
}
