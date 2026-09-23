import path from 'node:path'
import { buildManifestDiff } from './canonical-diff.ts'
import { buildReleaseManifest } from './canonical-mapper.ts'
import { validateCanonicalWorkbook } from './canonical-validator.ts'
import { writeImportArtifacts } from './report-writer.ts'
import { readCanonicalWorkbook } from './workbook-reader.mts'

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  return fallback
}

const workbookPath = argument(
  '--workbook',
  'outputs/method-p0-resolution/Pawside_三分化_Canonical_Method_Workbook_v1.2.xlsx',
)
const workbookVersion = argument('--version', '1.2')
const outputDir = argument('--output', 'artifacts/method-import/v1.2')
const baselinePath = argument('--baseline')

if (!workbookPath || !workbookVersion || !outputDir) {
  throw new Error('Missing required importer arguments')
}

const workbook = await readCanonicalWorkbook(path.resolve(workbookPath), workbookVersion)
const report = validateCanonicalWorkbook(workbook)
const manifest = buildReleaseManifest(workbook, report)
const diff = await buildManifestDiff(manifest, baselinePath)

await writeImportArtifacts(
  path.resolve(outputDir),
  report as unknown as Record<string, unknown>,
  manifest as unknown as Record<string, unknown>,
  diff,
)

console.log(
  JSON.stringify({
    valid: report.valid,
    runtimeGate: report.gates.runtime,
    strictGate: report.gates.strict,
    workbookChecksumSha256: report.workbookChecksumSha256,
    outputDir: path.resolve(outputDir),
  }),
)

if (!report.valid || report.gates.runtime === 'blocked') {
  process.exitCode = 1
}
