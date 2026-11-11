import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GUIDES, guideOgImage } from '@/lib/site/guides'

const read = (path: string) => readFileSync(path, 'utf8')
const description = (path: string) => read(path).match(/const DESCRIPTION = '([^']+)'/)?.[1] ?? ''

describe('site SEO metadata', () => {
  it('gives every public page a search snippet long enough to be used as-is', () => {
    for (const page of ['app/welcome/method/page.tsx', 'app/welcome/roadmap/page.tsx']) {
      const text = description(page)
      expect(text.length, page).toBeGreaterThanOrEqual(40)
      expect(text.length, page).toBeLessThanOrEqual(120)
    }
  })

  it('gives every guide its own share image (run scripts/site/og-guides.mjs after adding one)', () => {
    for (const guide of GUIDES) {
      const image = guideOgImage(guide)
      expect(existsSync(`public${image.url}`), image.url).toBe(true)
    }
    const page = read('app/welcome/guides/[slug]/page.tsx')
    expect(page).toMatch(/images: \[image\]/)
    expect(page).not.toMatch(/OG_IMAGE/)
  })

  it('marks the method page up as an Article dated like the sitemap', () => {
    const page = read('app/welcome/method/page.tsx')
    expect(page).toMatch(/'@type': 'Article'/)
    const updated = page.match(/const UPDATED = '([\d-]+)'/)?.[1]
    expect(read('app/sitemap.ts')).toContain(`{ path: '/welcome/method', lastModified: '${updated}'`)
  })
})
