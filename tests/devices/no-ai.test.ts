import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

/**
 * Oura's API agreement forbids giving Oura data (or anything derived from it) to an AI model.
 * Device data is display-only, so nothing that talks to a model may touch it. If this test
 * fails, do not edit it: remove the dependency, or get Oura's written consent first.
 */
const AI_FILES = [
  join(ROOT, 'lib/ai-client.ts'),
  join(ROOT, 'lib/ai-rules.ts'),
  ...files(join(ROOT, 'lib/ai')),
  ...files(join(ROOT, 'lib/evidence')),
  ...files(join(ROOT, 'lib/coach')),
  ...files(join(ROOT, 'lib/nutrition')),
  ...files(join(ROOT, 'app/api/ai')),
  join(ROOT, 'app/api/evidence/route.ts'),
  join(ROOT, 'app/api/workout/session-feedback/route.ts'),
].filter((path) => /\.(ts|tsx)$/.test(path))

const FORBIDDEN = /lib\/devices|devices\/oura|device_daily_metrics|device_connections|\boura\b/i

describe('device data never reaches AI code', () => {
  it('scans a non-trivial set of AI files', () => {
    expect(AI_FILES.length).toBeGreaterThan(20)
  })

  it.each(AI_FILES.map((path) => [path.replace(ROOT, '')] as const))('%s does not reference device data', (relative) => {
    expect(readFileSync(join(ROOT, relative), 'utf8')).not.toMatch(FORBIDDEN)
  })

  it('keeps the daily-review and compose routes free of device tables', () => {
    for (const route of ['app/api/ai/daily-review/route.ts', 'app/api/ai/compose/route.ts']) {
      expect(readFileSync(join(ROOT, route), 'utf8')).not.toMatch(FORBIDDEN)
    }
  })
})
