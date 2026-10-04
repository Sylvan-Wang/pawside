import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { POST } from '../../app/api/method-import/route'
import { GET } from '../../app/api/method-import/[id]/route'

function client(input?: { enabled?: boolean; insertError?: { code?: string; message: string } | null }) {
  const inserted: Array<Record<string, unknown>> = []
  const chain = {
    insert: vi.fn((value: Record<string, unknown>) => { inserted.push(value); return chain }),
    select: vi.fn(() => chain),
    single: vi.fn(async () => input?.insertError
      ? { data: null, error: input.insertError }
      : { data: { id: '10000000-0000-4000-8000-000000000001', status: 'draft', created_at: '2026-10-04T00:00:00Z' }, error: null }),
  }
  return {
    inserted,
    value: {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: '20000000-0000-4000-8000-000000000001' } }, error: null })) },
      rpc: vi.fn(async () => ({ data: input?.enabled ?? true, error: null })),
      from: vi.fn(() => chain),
    },
  }
}

describe('method import Route Handler behaviour', () => {
  beforeEach(() => mocks.createClient.mockReset())

  it('rejects a missing consent without creating an import', async () => {
    const mock = client()
    mocks.createClient.mockResolvedValue(mock.value)
    const response = await POST(new Request('http://local/api/method-import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw_text: '训练计划', consent_accepted: false, consent_version: 'health-v1' }),
    }))
    expect(response.status).toBe(400)
    expect(mock.inserted).toEqual([])
  })

  it('persists the exact consent and a deterministic SHA-256 checksum', async () => {
    const mock = client()
    mocks.createClient.mockResolvedValue(mock.value)
    const response = await POST(new Request('http://local/api/method-import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw_text: '肩部训练：推举 3 组，每组 8-10 次。', consent_accepted: true, consent_version: 'health-v1' }),
    }))
    expect(response.status).toBe(201)
    expect(mock.inserted[0]).toMatchObject({
      consent_version: 'health-v1', status: 'draft',
      text_checksum_sha256: '18373714f20b77bca3ddd1623907ece27dba683078a805b3f6a515ce90d3c36f',
    })
  })

  it('maps the database quota rejection to a user-facing 429', async () => {
    const mock = client({ insertError: { code: '54000', message: 'Import limit reached (5 per 24 hours)' } })
    mocks.createClient.mockResolvedValue(mock.value)
    const response = await POST(new Request('http://local/api/method-import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw_text: '肩部训练：推举 3 组，每组 8-10 次。', consent_accepted: true, consent_version: 'health-v1' }),
    }))
    expect(response.status).toBe(429)
  })

  it('returns validation rather than authentication for a malformed import id', async () => {
    const response = await GET(new Request('http://local/api/method-import/not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) })
    expect(response.status).toBe(400)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
