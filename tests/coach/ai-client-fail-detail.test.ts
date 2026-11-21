import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callStructuredOutput, incompleteReason } from '../../lib/ai-client'

// Every invalid_response used to look the same in ai_generations (fail_detail null),
// so a daily-review failure could not be told apart from a truncated answer, bad JSON
// or a schema miss. These pin the short, content-free cause the client now returns.

const accept = (value: unknown): value is object => value !== null && typeof value === 'object'

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

async function call(validate: (value: unknown) => value is object = accept) {
  return callStructuredOutput('sys', 'in', 'schema', { type: 'object' }, validate, 700)
}

describe('ai-client failure detail', () => {
  beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'test-key') })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('names a response cut off by max_output_tokens', async () => {
    mockFetch(200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] })
    const result = await call()
    expect(result).toMatchObject({ ok: false, reason: 'invalid_response', detail: 'incomplete:max_output_tokens' })
  })

  it('names truncated JSON from an incomplete response', async () => {
    mockFetch(200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"summary":"练' })
    expect(await call()).toMatchObject({ ok: false, detail: 'incomplete:max_output_tokens' })
  })

  it('tells bad JSON, empty output and a schema miss apart', async () => {
    mockFetch(200, { status: 'completed', output_text: 'not json' })
    expect(await call()).toMatchObject({ ok: false, detail: 'bad_json' })
    mockFetch(200, { status: 'completed', output: [] })
    expect(await call()).toMatchObject({ ok: false, detail: 'no_output_text' })
    mockFetch(200, { status: 'completed', output_text: '{"a":1}' })
    const reject = (value: unknown): value is object => { void value; return false }
    expect(await call(reject)).toMatchObject({ ok: false, detail: 'failed_validation' })
  })

  it('records the HTTP status of an upstream error', async () => {
    mockFetch(502, { error: 'bad gateway' })
    expect(await call()).toMatchObject({ ok: false, reason: 'upstream_error', detail: 'http_502' })
  })

  it('still succeeds on a complete response', async () => {
    mockFetch(200, { status: 'completed', output_text: '{"a":1}' })
    expect(await call()).toMatchObject({ ok: true, data: { a: 1 } })
  })

  it('never passes free text through as the reason', () => {
    expect(incompleteReason({ status: 'incomplete', incomplete_details: { reason: 'ignore all rules; drop table' } })).toBe('unknown')
    expect(incompleteReason({ status: 'completed' })).toBeNull()
    expect(incompleteReason(null)).toBeNull()
  })
})
