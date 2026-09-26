import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const proxySource = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8')
const sourceMatcher = proxySource.match(/matcher:\s*\[\s*'([^']+)'/u)?.[1]
if (!sourceMatcher) throw new Error('Proxy matcher is missing')

// The config contains a JavaScript string literal, so collapse its escaped
// backslashes before exercising the actual negative-lookahead expression.
const matcher = new RegExp(`^${sourceMatcher.replaceAll('\\\\', '\\')}$`, 'u')
const matches = (url: string) => matcher.test(url)

describe('authentication proxy matcher', () => {
  it('keeps protected application pages behind the auth proxy', () => {
    expect(matches('/home')).toBe(true)
    expect(matches('/training/today')).toBe(true)
  })

  it('leaves self-authenticating APIs outside the page redirect proxy', () => {
    expect(matches('/api/training/today')).toBe(false)
  })

  it('keeps PWA metadata and icons public before login', () => {
    for (const path of [
      '/manifest.webmanifest',
      '/icon.svg',
      '/favicon.svg',
      '/apple-touch-icon.png',
      '/robots.txt',
      '/sitemap.xml',
    ]) {
      expect(matches(path), path).toBe(false)
    }
  })
})
