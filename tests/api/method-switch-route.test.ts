import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const getUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}))

import { POST } from '@/app/api/method/switch/route'

const RELEASE = '2b04e487-58fc-4cb0-a8c4-22e04d04d355'

function request(body: unknown) {
  return new Request('http://localhost/api/method/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/method/switch', () => {
  beforeEach(() => {
    rpc.mockReset()
    getUser.mockReset()
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  })

  it('requires a signed-in user and never reaches the database without one', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await POST(request({ method_release_id: RELEASE }))
    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed bodies before calling the RPC', async () => {
    expect((await POST(request('not json'))).status).toBe(400)
    expect((await POST(request({}))).status).toBe(400)
    expect((await POST(request({ method_release_id: 'abc' }))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('passes the release id to switch_method_release_v1 and returns its result', async () => {
    rpc.mockResolvedValue({ data: { status: 'switched', enrollment_id: 'e1', method_release_id: RELEASE, next_split_key: 'chest' }, error: null })
    const response = await POST(request({ method_release_id: RELEASE }))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('switch_method_release_v1', { p_release_id: RELEASE, p_start_split_key: null })
    const payload = await response.json()
    expect(payload.data.next_split_key).toBe('chest')
  })

  it('passes the chosen start day and rejects a malformed one', async () => {
    rpc.mockResolvedValue({ data: { status: 'switched', enrollment_id: 'e1', method_release_id: RELEASE, next_split_key: 'shoulders' }, error: null })
    const response = await POST(request({ method_release_id: RELEASE, start_split_key: 'shoulders' }))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('switch_method_release_v1', { p_release_id: RELEASE, p_start_split_key: 'shoulders' })
    expect((await POST(request({ method_release_id: RELEASE, start_split_key: 'Bad Day' }))).status).toBe(400)
  })

  it('maps a session in progress to 409 and an unavailable release to 404', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'x' } })
    expect((await POST(request({ method_release_id: RELEASE }))).status).toBe(409)
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'x' } })
    expect((await POST(request({ method_release_id: RELEASE }))).status).toBe(404)
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'x' } })
    expect((await POST(request({ method_release_id: RELEASE }))).status).toBe(500)
  })
})
