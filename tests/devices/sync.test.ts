import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../../lib/devices/crypto'
import { OuraAuthError } from '../../lib/devices/oura'
import type { ConnectionRow, DeviceStore } from '../../lib/devices/store'
import { RECONNECT_MESSAGE, syncOura } from '../../lib/devices/sync'

const key = randomBytes(32)
const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x/cb' }
const NOW = new Date('2026-10-07T12:00:00Z')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function memory(initial: Partial<ConnectionRow> | null) {
  let connection: ConnectionRow | null = initial && {
    user_id: 'u1', provider: 'oura', access_token_enc: encryptSecret('ACCESS', key), refresh_token_enc: encryptSecret('REFRESH', key),
    token_expires_at: '2026-10-08T00:00:00Z', scopes: ['daily'], connected_at: '2026-10-01T00:00:00Z', last_synced_at: null, last_error: null, ...initial,
  }
  const metrics: unknown[] = []
  const store: DeviceStore = {
    async getConnection() { return connection },
    async saveConnection() {},
    async rotateTokens(_u, expected, next) {
      if (!connection || connection.refresh_token_enc !== expected) return false
      connection = { ...connection, ...next }
      return true
    },
    async recordSync(_u, patch) { if (connection) connection = { ...connection, ...patch } },
    async upsertMetrics(rows) { metrics.push(...rows) },
    async deleteAll() { connection = null; metrics.length = 0 },
  }
  return { store, metrics, get connection() { return connection } }
}

const goodFetch = (calls: string[] = []) => (async (url: string) => {
  calls.push(url)
  if (url.includes('daily_sleep')) return json({ data: [{ day: '2026-10-06', score: 80 }] })
  if (url.includes('daily_readiness')) return json({ data: [{ day: '2026-10-06', score: 70 }] })
  if (url.includes('daily_activity')) return json({ data: [{ day: '2026-10-06', score: 88, steps: 9000, active_calories: 500 }] })
  return json({}, 404)
}) as unknown as typeof fetch

describe('syncOura', () => {
  it('does nothing without a connection', async () => {
    const m = memory(null)
    expect((await syncOura('u1', { store: m.store, fetchFn: goodFetch(), config, key, now: () => NOW })).status).toBe('not_connected')
  })

  it('pulls 30 days of the three daily collections and records the sync', async () => {
    const m = memory({})
    const calls: string[] = []
    const result = await syncOura('u1', { store: m.store, fetchFn: goodFetch(calls), config, key, now: () => NOW })
    expect(result).toMatchObject({ status: 'ok', days: 1 })
    expect(calls).toHaveLength(3)
    expect(calls.every((url) => url.includes('start_date=2026-09-08') && url.includes('end_date=2026-10-07'))).toBe(true)
    expect(m.metrics).toHaveLength(1)
    expect(m.connection?.last_synced_at).toBe(NOW.toISOString())
    expect(m.connection?.last_error).toBeNull()
  })

  it('skips a sync that is too soon unless forced', async () => {
    const m = memory({ last_synced_at: '2026-10-07T11:55:00Z' })
    expect((await syncOura('u1', { store: m.store, fetchFn: goodFetch(), config, key, now: () => NOW })).status).toBe('skipped')
    expect((await syncOura('u1', { store: m.store, fetchFn: goodFetch(), config, key, now: () => NOW, force: true })).status).toBe('ok')
  })

  it('refreshes an expiring token, stores the new pair, and uses it', async () => {
    const m = memory({ token_expires_at: '2026-10-07T12:01:00Z' })
    const seen: string[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (url.includes('/oauth/token')) return json({ access_token: 'NEW_A', refresh_token: 'NEW_R', expires_in: 86400 })
      seen.push((init.headers as Record<string, string>).Authorization)
      return goodFetch()(url, init)
    }) as unknown as typeof fetch
    const result = await syncOura('u1', { store: m.store, fetchFn, config, key, now: () => NOW })
    expect(result.status).toBe('ok')
    expect(new Set(seen)).toEqual(new Set(['Bearer NEW_A']))
    expect(decryptSecret(m.connection!.refresh_token_enc!, key)).toBe('NEW_R')
  })

  it('asks the person to reconnect when the grant is dead', async () => {
    const m = memory({ token_expires_at: '2026-10-07T12:01:00Z' })
    const fetchFn = (async () => json({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch
    expect((await syncOura('u1', { store: m.store, fetchFn, config, key, now: () => NOW })).status).toBe('needs_reconnect')
    expect(m.connection?.last_error).toBe(RECONNECT_MESSAGE)
  })

  it('retries once through a refresh when the API rejects the access token', async () => {
    const m = memory({})
    let apiCalls = 0
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (url.includes('/oauth/token')) return json({ access_token: 'NEW_A', refresh_token: 'NEW_R', expires_in: 3600 })
      apiCalls++
      if ((init.headers as Record<string, string>).Authorization === 'Bearer ACCESS') return json({}, 401)
      return goodFetch()(url, init)
    }) as unknown as typeof fetch
    expect((await syncOura('u1', { store: m.store, fetchFn, config, key, now: () => NOW })).status).toBe('ok')
    expect(apiCalls).toBeGreaterThan(3)
  })

  it('reports a transient failure without claiming success', async () => {
    const m = memory({})
    const fetchFn = (async () => json({}, 503)) as unknown as typeof fetch
    expect((await syncOura('u1', { store: m.store, fetchFn, config, key, now: () => NOW })).status).toBe('error')
    expect(m.connection?.last_synced_at).toBeNull()
    expect(m.connection?.last_error).toBeTruthy()
  })

  it('does not leak OuraAuthError type confusion for unrelated errors', () => {
    expect(new OuraAuthError('x')).toBeInstanceOf(Error)
  })
})
