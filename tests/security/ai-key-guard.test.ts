import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Weekly security patrol, automated part: the OpenAI key must never reach the
// browser, and every route that can call the model must check login and rate-limit.

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

const sources = ['app', 'lib', 'components'].flatMap((d) => walk(d))

describe('OpenAI key stays on the server', () => {
  it('no NEXT_PUBLIC_ variable carries an OpenAI or service-role secret', () => {
    const offenders = sources.filter((f) => /NEXT_PUBLIC_[A-Z_]*(OPENAI|SERVICE_ROLE|SECRET)/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
  it('OPENAI_API_KEY is read only in the server-side AI client', () => {
    const readers = sources.filter((f) => readFileSync(f, 'utf8').includes('OPENAI_API_KEY'))
    expect(readers).toEqual(['lib/ai-client.ts'])
  })
  it('client components never import the AI client', () => {
    const offenders = sources.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return /^['"]use client['"]/m.test(src) && /ai-client/.test(src)
    })
    expect(offenders).toEqual([])
  })
})

describe('model-calling routes check login and rate-limit', () => {
  const routes = [...walk('app/api/ai'), ...walk('app/api/coach')].filter((f) => f.endsWith('route.ts'))
  it.each(routes)('%s checks the signed-in user', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/requireCoachUser|auth\.getUser\(/)
  })
  it.each(['app/api/coach/chat/route.ts', 'app/api/ai/plans/route.ts'])('%s has a per-user limit', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/RATE_LIMITED/)
  })
})
