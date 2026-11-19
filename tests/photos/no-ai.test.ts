import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

/**
 * Album photos are stored for their owner only; the privacy page promises they
 * are never sent to a model. Nothing that builds a model request may read them.
 */
const AI_FILES = [
  join(ROOT, 'lib/ai-client.ts'),
  join(ROOT, 'lib/ai-rules.ts'),
  ...files(join(ROOT, 'lib/ai')),
  ...files(join(ROOT, 'lib/evidence')),
  ...files(join(ROOT, 'lib/coach')),
  ...files(join(ROOT, 'lib/nutrition')),
  ...files(join(ROOT, 'lib/coach-chat')),
  ...files(join(ROOT, 'app/api/ai')),
  ...files(join(ROOT, 'app/api/coach')),
].filter((path) => /\.(ts|tsx)$/.test(path))

const FORBIDDEN = /lib\/photos|user_photos|user-photos|\/api\/photos/

describe('album photos never reach AI code', () => {
  it.each(AI_FILES.map((path) => [path.replace(ROOT, '')] as const))('%s does not reference photos', (relative) => {
    expect(readFileSync(join(ROOT, relative), 'utf8')).not.toMatch(FORBIDDEN)
  })
})
