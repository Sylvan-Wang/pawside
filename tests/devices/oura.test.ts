import { describe, expect, it, vi } from 'vitest'
import {
  OURA_SCOPE,
  OuraAuthError,
  buildAuthorizeUrl,
  exchangeCode,
  fetchDaily,
  ouraConfig,
  refreshTokens,
  toMetricRows,
} from '../../lib/devices/oura'

const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://paw-side.com/api/devices/oura/callback' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('oura config and authorize url', () => {
  it('needs both credentials and defaults the redirect to the registered callback', () => {
    expect(ouraConfig({})).toBeNull()
    expect(ouraConfig({ OURA_CLIENT_ID: 'a' })).toBeNull()
    expect(ouraConfig({ OURA_CLIENT_ID: 'a', OURA_CLIENT_SECRET: 'b' })?.redirectUri).toBe('https://paw-side.com/api/devices/oura/callback')
  })

  it('asks for the daily scope only, with state', () => {
    const url = new URL(buildAuthorizeUrl(config, 'abc123'))
    expect(url.origin + url.pathname).toBe('https://cloud.ouraring.com/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe('daily')
    expect(OURA_SCOPE).toBe('daily')
    expect(url.searchParams.get('state')).toBe('abc123')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
  })
})

describe('token requests', () => {
  const now = new Date('2026-10-07T00:00:00Z')

  it('exchanges a code and computes the expiry', async () => {
    const fetchFn = vi.fn(async () => json({ access_token: 'A', refresh_token: 'R', expires_in: 86400, scope: 'daily' })) as unknown as typeof fetch
    const tokens = await exchangeCode(fetchFn, config, 'code1', now)
    expect(tokens).toMatchObject({ accessToken: 'A', refreshToken: 'R', scopes: ['daily'] })
    expect(tokens.expiresAt.toISOString()).toBe('2026-10-08T00:00:00.000Z')
    const body = new URLSearchParams((fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('code1')
  })

  it('treats a rejected grant as "connect again", other failures as errors', async () => {
    await expect(refreshTokens((async () => json({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch, config, 'old', now)).rejects.toBeInstanceOf(OuraAuthError)
    await expect(refreshTokens((async () => json({}, 503)) as unknown as typeof fetch, config, 'old', now)).rejects.not.toBeInstanceOf(OuraAuthError)
  })
})

describe('fetchDaily', () => {
  it('follows next_token and sends the bearer token', async () => {
    const calls: string[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push(url)
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN')
      return url.includes('next_token=n2') ? json({ data: [{ day: '2026-10-02' }], next_token: null }) : json({ data: [{ day: '2026-10-01' }], next_token: 'n2' })
    }) as unknown as typeof fetch
    const days = await fetchDaily<{ day: string }>(fetchFn, 'TOKEN', 'daily_sleep', '2026-10-01', '2026-10-07')
    expect(days.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02'])
    expect(calls[0]).toContain('/v2/usercollection/daily_sleep?start_date=2026-10-01&end_date=2026-10-07')
  })

  it('turns 401 into an auth error', async () => {
    await expect(fetchDaily((async () => json({}, 401)) as unknown as typeof fetch, 'T', 'daily_sleep', 'a', 'b')).rejects.toBeInstanceOf(OuraAuthError)
  })
})

describe('toMetricRows', () => {
  it('merges the collections per day and keeps missing values null, never 0', () => {
    const rows = toMetricRows('u1',
      [{ day: '2026-10-02', score: 81 }, { day: '2026-10-01', score: null }],
      [{ day: '2026-10-02', score: 74 }],
      [{ day: '2026-10-03', score: 90, steps: 8123, active_calories: 410 }],
    )
    expect(rows.map((row) => row.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(rows[0]).toMatchObject({ sleep_score: null, readiness_score: null, steps: null })
    expect(rows[1]).toMatchObject({ sleep_score: 81, readiness_score: 74, steps: null })
    expect(rows[2]).toMatchObject({ activity_score: 90, steps: 8123, active_calories: 410, sleep_score: null })
  })

  it('drops out-of-range numbers instead of storing them', () => {
    const [row] = toMetricRows('u1', [{ day: '2026-10-01', score: 250 }], [], [{ day: '2026-10-01', steps: -5 }])
    expect(row.sleep_score).toBeNull()
    expect(row.steps).toBeNull()
  })
})
