import { beforeEach, describe, expect, it, vi } from 'vitest'

const insert = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ insert }) }),
}))

import { POST } from '@/app/api/seed-signup/route'

let counter = 0
const post = (body: unknown, ip = `10.0.0.${++counter}`) =>
  POST(new Request('http://x/api/seed-signup', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }))

describe('POST /api/seed-signup', () => {
  beforeEach(() => { insert.mockReset(); insert.mockResolvedValue({ error: null }) })

  it('stores a lower-cased email and an optional name', async () => {
    const response = await post({ email: ' Me@Example.COM ', name: ' 小周 ' })
    expect(response.status).toBe(200)
    expect(insert).toHaveBeenCalledWith({ email: 'me@example.com', name: '小周', source: 'welcome' })
  })

  it('accepts an email without a name', async () => {
    expect((await post({ email: 'a@b.co' })).status).toBe(200)
    expect(insert).toHaveBeenCalledWith({ email: 'a@b.co', name: null, source: 'welcome' })
  })

  it('rejects a missing or malformed email and stores nothing', async () => {
    expect((await post({ name: 'x' })).status).toBe(400)
    expect((await post({ email: 'not-an-email' })).status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('answers a filled honeypot with success and stores nothing', async () => {
    expect((await post({ email: 'bot@example.com', website: 'http://spam' })).status).toBe(200)
    expect(insert).not.toHaveBeenCalled()
  })

  it('treats a duplicate email as success, so the list is never revealed', async () => {
    insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })
    expect((await post({ email: 'dup@example.com' })).status).toBe(200)
  })

  it('reports a real storage failure honestly', async () => {
    insert.mockResolvedValue({ error: { code: '42P01', message: 'relation does not exist' } })
    expect((await post({ email: 'a@example.com' })).status).toBe(503)
  })

  it('slows down one address that posts too often', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) statuses.push((await post({ email: `n${i}@example.com` }, '10.9.9.9')).status)
    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true)
    expect(statuses[6]).toBe(429)
  })
})
