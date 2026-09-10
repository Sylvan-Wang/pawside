import { readFile } from 'node:fs/promises'

export async function buildManifestDiff(
  current: Record<string, unknown>,
  baselinePath?: string,
) {
  if (!baselinePath) {
    return {
      baseline: null,
      changeType: 'initial_import',
      currentReleaseVersion: current.releaseVersion,
    }
  }

  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as Record<string, unknown>
  return {
    baseline: baselinePath,
    changeType: 'release_update',
    previousReleaseVersion: baseline.releaseVersion ?? null,
    currentReleaseVersion: current.releaseVersion ?? null,
    workbookChecksumChanged:
      baseline.workbookChecksumSha256 !== current.workbookChecksumSha256,
    gatesChanged: JSON.stringify(baseline.gates) !== JSON.stringify(current.gates),
    p0RuntimeDefaultsChanged:
      JSON.stringify(baseline.p0RuntimeDefaults) !==
      JSON.stringify(current.p0RuntimeDefaults),
  }
}
