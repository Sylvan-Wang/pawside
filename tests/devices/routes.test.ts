import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret } from '../../lib/devices/crypto'

const KEY = randomBytes(32)
let signedIn = true
let featureOn = true
let adminAvailable = true
const saved: Record<string, unknown>[] = []
let deleted: string[] = []
let connection: Record<string, unknown> | null = null
let metricsRows: Record<string, unknown>[] = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null }, error: null }) },
    rpc: async () => ({ data: featureOn }),
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: metricsRows, error: null }) }) }) }),
    }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => (adminAvailable ? {} : null) }))
vi.mock('@/lib/devices/store', () => ({
  supabaseDeviceStore: () => ({
    getConnection: async () => connection,
    saveConnection: async (row: Record<string, unknown>) => { saved.push(row) },
    rotateTokens: async () => true,
    recordSync: async () => {},
    upsertMetrics: async () => {},
    deleteAll: async (id: string) => { deleted.push(id) },
  }),
}))

import { GET as callback } from '@/app/api/devices/oura/callback/route'
import { GET as connect } from '@/app/api/devices/oura/connect/route'
import { POST as disconnect } from '@/app/api/devices/oura/disconnect/route'
import { GET as status } from '@/app/api/devices/oura/status/route'
import { STATE_COOKIE } from '@/lib/devices/route'

const BASE = 'https://paw-side.com'
const get = (path: string, cookie?: string) => new NextRequest(BASE + path, { headers: cookie ? { cookie } : {} })
const location = (response: Response) => new URL(response.headers.get('location')!)

beforeEach(() => {
  signedIn = true; featureOn = true; adminAvailable = true; saved.length = 0; deleted = []; connection = null; metricsRows = []
  process.env.OURA_CLIENT_ID = 'cid'
  process.env.OURA_CLIENT_SECRET = 'secret'
  process.env.DEVICE_TOKEN_ENCRYPTION_KEY = KEY.toString('base64')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/oauth/token')) return new Response(JSON.stringify({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 86400, scope: 'daily' }), { status: 200 })
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }))
})

describe('GET /api/devices/oura/connect', () => {
  it('sends signed-out visitors to login', async () => {
    signedIn = false
    expect(location(await connect(get('/api/devices/oura/connect'))).pathname).toBe('/auth')
  })

  it('stays closed for people without the beta', async () => {
    featureOn = false
    expect(location(await connect(get('/api/devices/oura/connect'))).search).toContain('status=unavailable')
  })

  it('says unavailable when Oura or the key is not configured', async () => {
    delete process.env.OURA_CLIENT_ID
    expect(location(await connect(get('/api/devices/oura/connect'))).search).toContain('status=unavailable')
  })

  it('redirects to Oura with the daily scope and a state that matches the cookie', async () => {
    const response = await connect(get('/api/devices/oura/connect'))
    const target = location(response)
    expect(target.origin + target.pathname).toBe('https://cloud.ouraring.com/oauth/authorize')
    expect(target.searchParams.get('scope')).toBe('daily')
    const state = target.searchParams.get('state')!
    expect(state.length).toBeGreaterThanOrEqual(32)
    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toContain(`${STATE_COOKIE}=${state}`)
    expect(cookie.toLowerCase()).toContain('httponly')
  })
})

describe('GET /api/devices/oura/callback', () => {
  const cookie = `${STATE_COOKIE}=goodstate`

  it('rejects a state that does not match the cookie, and stores nothing', async () => {
    const response = await callback(get('/api/devices/oura/callback?code=c&state=evil', cookie))
    expect(location(response).search).toContain('status=failed')
    expect(saved).toHaveLength(0)
  })

  it('rejects a callback with no cookie at all', async () => {
    expect(location(await callback(get('/api/devices/oura/callback?code=c&state=goodstate'))).search).toContain('status=failed')
    expect(saved).toHaveLength(0)
  })

  it('treats "access denied" as a refusal, not a failure', async () => {
    expect(location(await callback(get('/api/devices/oura/callback?error=access_denied&state=goodstate', cookie))).search).toContain('status=denied')
    expect(saved).toHaveLength(0)
  })

  it('stores the tokens encrypted and reports connected', async () => {
    const response = await callback(get('/api/devices/oura/callback?code=abc&state=goodstate', cookie))
    expect(location(response).search).toContain('status=connected')
    expect(saved).toHaveLength(1)
    const row = saved[0] as { access_token_enc: string; refresh_token_enc: string; user_id: string }
    expect(row.user_id).toBe('u1')
    expect(JSON.stringify(row)).not.toContain('ACCESS"')
    expect(row.access_token_enc).not.toContain('ACCESS')
    expect(decryptSecret(row.access_token_enc, KEY)).toBe('ACCESS')
    expect(decryptSecret(row.refresh_token_enc, KEY)).toBe('REFRESH')
    expect(response.headers.get('set-cookie')).toContain(`${STATE_COOKIE}=;`)
  })

  it('stays closed without the beta', async () => {
    featureOn = false
    expect(location(await callback(get('/api/devices/oura/callback?code=abc&state=goodstate', cookie))).search).toContain('status=unavailable')
    expect(saved).toHaveLength(0)
  })
})

describe('POST /api/devices/oura/disconnect', () => {
  it('needs a signed-in person', async () => {
    signedIn = false
    expect((await disconnect()).status).toBe(401)
    expect(deleted).toHaveLength(0)
  })

  it('deletes the person\'s credentials and metrics, even if the beta flag is off', async () => {
    featureOn = false
    const response = await disconnect()
    expect(response.status).toBe(200)
    expect(deleted).toEqual(['u1'])
  })

  it('is honest when it cannot do it', async () => {
    adminAvailable = false
    expect((await disconnect()).status).toBe(503)
  })
})

describe('GET /api/devices/oura/status', () => {
  it('reports the beta as off', async () => {
    featureOn = false
    const body = await (await status()).json()
    expect(body.data).toEqual({ enabled: false })
  })

  it('reports connected state and the synced days, oldest first, with no token fields', async () => {
    connection = { access_token_enc: 'secret', refresh_token_enc: 'secret', last_synced_at: '2026-10-07T00:00:00Z', last_error: null }
    metricsRows = [{ day: '2026-10-07', sleep_score: 80 }, { day: '2026-10-06', sleep_score: 70 }]
    const body = await (await status()).json()
    expect(body.data.connected).toBe(true)
    expect(body.data.metrics.map((m: { day: string }) => m.day)).toEqual(['2026-10-06', '2026-10-07'])
    expect(JSON.stringify(body)).not.toContain('secret')
  })
})
