import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveFirstTouch } from '@/lib/site/attribution'

const NOW = new Date('2026-11-09T00:00:00Z')
const page = (path: string) => new URL(`https://paw-side.com${path}`)

describe('first-touch attribution', () => {
  it('names known search engines and social sites from the referrer', () => {
    expect(deriveFirstTouch(page('/'), 'https://www.google.com/', NOW)?.source).toBe('google')
    expect(deriveFirstTouch(page('/'), 'https://cn.bing.com/search?q=x', NOW)?.source).toBe('bing')
    expect(deriveFirstTouch(page('/'), 'https://www.baidu.com/link?url=x', NOW)?.source).toBe('baidu')
    expect(deriveFirstTouch(page('/'), 'https://www.xiaohongshu.com/explore/1', NOW)?.source).toBe('xiaohongshu')
  })

  it('prefers utm tags and keeps only the referrer host, never its path', () => {
    const touch = deriveFirstTouch(page('/welcome/guides/x?utm_source=XHS&utm_campaign=w46'), 'https://example.org/secret?id=1', NOW)
    expect(touch).toMatchObject({ source: 'xhs', campaign: 'w46', referrer: 'example.org', landing: '/welcome/guides/x' })
    expect(JSON.stringify(touch)).not.toContain('secret')
  })

  it('records direct visits and skips internal navigation', () => {
    expect(deriveFirstTouch(page('/'), '', NOW)?.source).toBe('direct')
    expect(deriveFirstTouch(page('/welcome/method'), 'https://paw-side.com/', NOW)).toBeNull()
  })

  it('analytics and attribution run on the public site only, and are disclosed', () => {
    const site = readFileSync('app/welcome/layout.tsx', 'utf8')
    expect(site).toContain('<SiteAnalytics />')
    expect(site).toContain('<FirstTouch />')
    expect(readFileSync('app/layout.tsx', 'utf8')).not.toMatch(/SiteAnalytics|cloudflareinsights/)
    const privacy = readFileSync('app/privacy/page.tsx', 'utf8')
    expect(privacy).toContain('Cloudflare Web Analytics')
    expect(privacy).toContain('注册来源')
  })
})
