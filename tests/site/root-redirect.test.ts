import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// SEO: the bare domain is the strongest page. Logged-out visitors and crawlers must
// land on the public site (/welcome), never on the noindex login page.
describe('root path for logged-out visitors', () => {
  it('proxy sends logged-out "/" to /welcome', () => {
    const src = readFileSync('proxy.ts', 'utf8')
    expect(src).toMatch(/!user && pathname === '\/'[\s\S]{0,120}new URL\('\/welcome'/)
  })
  it('root page falls back to /welcome, not /auth', () => {
    const src = readFileSync('app/page.tsx', 'utf8')
    expect(src).toContain("if (!user) redirect('/welcome')")
  })
})
