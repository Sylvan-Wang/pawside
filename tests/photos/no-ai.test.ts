import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

/**
 * Album photos are stored for their owner only. The privacy page promises that
 * only 「识别这一餐」 sends photos to a model, and only meal photos. So exactly
 * one chat module and its route may touch the album; every other AI file may not.
 */
const ALLOWED = new Set(['/lib/coach-chat/photo-meal.ts', '/app/api/coach/photo-meal/route.ts'])
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
].filter((path) => /\.(ts|tsx)$/.test(path) && !ALLOWED.has(path.replace(ROOT, '')))

const FORBIDDEN = /lib\/photos|user_photos|user-photos|\/api\/photos/

describe('album photos never reach AI code', () => {
  it.each(AI_FILES.map((path) => [path.replace(ROOT, '')] as const))('%s does not reference photos', (relative) => {
    expect(readFileSync(join(ROOT, relative), 'utf8')).not.toMatch(FORBIDDEN)
  })

  it('only lets 识别这一餐 use meal photos', () => {
    const source = readFileSync(join(ROOT, 'lib/coach-chat/photo-meal.ts'), 'utf8')
    expect(source).toMatch(/photo\.category === 'meal'/)
  })
})
