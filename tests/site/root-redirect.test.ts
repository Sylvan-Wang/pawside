import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// SEO: the public homepage lives at the bare domain. Logged-out visitors and crawlers get
// it served at "/" (a rewrite, not a redirect); the old /welcome address moves there for good.
describe('homepage at the bare domain', () => {
  const proxy = readFileSync('proxy.ts', 'utf8')
  it('serves the homepage at "/" for logged-out visitors', () => {
    expect(proxy).toMatch(/!user && pathname === '\/'[\s\S]{0,80}NextResponse\.rewrite\(new URL\('\/welcome'/)
  })
  it('permanently moves /welcome to "/"', () => {
    expect(proxy).toMatch(/pathname === '\/welcome'[\s\S]{0,200}NextResponse\.redirect\(target, 308\)/)
  })
  it('homepage canonical and sitemap point at the bare domain', () => {
    expect(readFileSync('app/welcome/page.tsx', 'utf8')).toContain("canonical: '/'")
    expect(readFileSync('app/sitemap.ts', 'utf8')).not.toContain("path: '/welcome',")
  })
  it('structured data never links to the redirected /welcome address', () => {
    for (const file of ['app/welcome/method/page.tsx', 'app/welcome/roadmap/page.tsx', 'app/welcome/guides/page.tsx', 'app/welcome/guides/[slug]/page.tsx']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\$\{SITE_URL\}\/welcome`/)
    }
  })
})
