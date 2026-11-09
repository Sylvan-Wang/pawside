import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import sitemap from '@/app/sitemap'
import { GUIDES, guidePath } from '@/lib/site/guides'
import { INDEXNOW_KEY, sitemapUrls } from '../../netlify/plugins/indexnow/indexnow.js'

describe('training guides (/welcome/guides)', () => {
  it('have unique slugs and complete metadata', () => {
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(GUIDES.length)
    for (const guide of GUIDES) {
      expect(guide.slug).toMatch(/^[a-z0-9-]+$/)
      expect(guide.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(guide.updated >= guide.published).toBe(true)
      expect(guide.description.length, guide.slug).toBeGreaterThan(40)
      expect(guide.description.length, guide.slug).toBeLessThan(140)
      expect(guide.body.filter((block) => block.type === 'h2').length).toBeGreaterThan(2)
    }
  })

  it('end with the medical disclaimer and never name a method author', () => {
    for (const guide of GUIDES) {
      const last = guide.body.at(-1)
      expect(last?.type).toBe('note')
      expect(JSON.stringify(guide)).not.toMatch(/凯圣王|谭成义/)
    }
  })

  it('are all in the sitemap', () => {
    const urls = sitemap().map((entry) => entry.url)
    for (const guide of GUIDES) expect(urls).toContain(`https://paw-side.com${guidePath(guide)}`)
    expect(urls).toContain('https://paw-side.com/welcome/guides')
  })

  it('IndexNow key file is published and matches the plugin', () => {
    const file = `public/${INDEXNOW_KEY}.txt`
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8').trim()).toBe(INDEXNOW_KEY)
    expect(readFileSync('netlify.toml', 'utf8')).toContain('/netlify/plugins/indexnow')
    expect(sitemapUrls('<url><loc>https://paw-side.com/a</loc></url><url><loc>https://evil.example/b</loc></url>')).toEqual(['https://paw-side.com/a'])
  })
})
