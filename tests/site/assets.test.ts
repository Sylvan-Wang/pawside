import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')

describe('site demo assets', () => {
  it('has all three self-hosted frames for every exercise the demo animates', () => {
    const screens = readFileSync(join(ROOT, 'components/site/screens.tsx'), 'utf8')
    const slugs = [...screens.matchAll(/<ExerciseFrames slug="([a-z-]+)"/g)].map((match) => match[1])
    expect(slugs.length).toBeGreaterThan(0)
    for (const slug of new Set(slugs)) {
      for (const frame of [1, 2, 3]) {
        expect(existsSync(join(ROOT, `public/welcome-assets/exercises/${slug}/frame-${frame}.png`))).toBe(true)
      }
    }
  })

  it('credits the exercise artwork (CC BY-SA 4.0) in the site footer', () => {
    const footer = readFileSync(join(ROOT, 'components/site/SiteFooter.tsx'), 'utf8')
    expect(footer).toMatch(/WORKOUT_GUIDE_ATTRIBUTION_TEXT/)
    expect(footer).toMatch(/WORKOUT_GUIDE_LICENSE_URL/)
  })

  it('only animates exercises that have a registered illustration in the app', () => {
    // 杠铃卧推 -> bench-press is a confirmed mapping (supabase/migrations/20260906000200_*).
    const screens = readFileSync(join(ROOT, 'components/site/screens.tsx'), 'utf8')
    expect(screens).not.toMatch(/单手绳索下拉<\/p>\s*<ExerciseFrames/)
  })

  it('serves the cat stickers without a login (the public site uses them too)', () => {
    const proxy = readFileSync(join(ROOT, 'proxy.ts'), 'utf8')
    expect(proxy).toMatch(/publicPaths = \[[^\]]*'\/cats'/)
    for (const name of ['crying', 'confused', 'shock', 'cool', 'love', 'tongue', 'sulk', 'party', 'rocket']) {
      expect(existsSync(join(ROOT, `public/cats/${name}.png`)), name).toBe(true)
    }
  })
})
