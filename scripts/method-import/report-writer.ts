import { mkdir, writeFile } from 'node:fs/promises'

export async function writeImportArtifacts(
  outputDir: string,
  report: Record<string, unknown>,
  manifest: Record<string, unknown>,
  diff: Record<string, unknown>,
) {
  const gates = report.gates as { runtime?: unknown; strict?: unknown }
  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    writeFile(outputDir + '/validation-report.json', JSON.stringify(report, null, 2)),
    writeFile(outputDir + '/release-manifest.json', JSON.stringify(manifest, null, 2)),
    writeFile(outputDir + '/canonical-diff.json', JSON.stringify(diff, null, 2)),
    writeFile(
      outputDir + '/validation-report.md',
      [
        '# Canonical Import Validation ' + String(report.workbookVersion ?? ''),
        '',
        '- Valid: ' + String(report.valid),
        '- Runtime gate: ' + String(gates.runtime),
        '- Strict gate: ' + String(gates.strict),
        '- Workbook SHA-256: ' + String(report.workbookChecksumSha256 ?? ''),
        '',
        'This report validates a draft release input. It is not an activation record.',
        '',
      ].join('\n'),
    ),
  ])
}
