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
})
