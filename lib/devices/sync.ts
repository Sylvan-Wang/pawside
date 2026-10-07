import { decryptSecret, encryptSecret } from './crypto'
import {
  type FetchFn,
  type OuraConfig,
  type OuraTokens,
  OuraAuthError,
  fetchDaily,
  refreshTokens,
  toMetricRows,
} from './oura'
import type { ConnectionRow, DeviceStore } from './store'

export const SYNC_DAYS = 30
const MIN_SYNC_GAP_MS = 10 * 60 * 1000
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export const RECONNECT_MESSAGE = '授权已失效，请重新连接'
const FAILED_MESSAGE = '这次同步没成功，稍后会再试'

export type SyncResult =
  | { status: 'ok'; days: number; syncedAt: string }
  | { status: 'skipped' }
  | { status: 'not_connected' }
  | { status: 'needs_reconnect' }
  | { status: 'error' }

export interface SyncDeps {
  store: DeviceStore
  fetchFn: FetchFn
  config: OuraConfig
  key: Buffer
  now?: () => Date
  force?: boolean
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Pull the last 30 days of daily summaries for one person and store them.
 *
 * Refresh tokens are single-use, so a refresh is written with a compare-and-set: if another
 * request already rotated them, we re-read and use the winner's token instead of failing.
 */
export async function syncOura(userId: string, deps: SyncDeps): Promise<SyncResult> {
  const { store, fetchFn, config, key } = deps
  const now = (deps.now ?? (() => new Date()))()

  let connection = await store.getConnection(userId)
  if (!connection) return { status: 'not_connected' }

  if (!deps.force && connection.last_synced_at && !connection.last_error
      && now.getTime() - new Date(connection.last_synced_at).getTime() < MIN_SYNC_GAP_MS) {
    return { status: 'skipped' }
  }

  async function refresh(current: ConnectionRow): Promise<ConnectionRow | null> {
    if (!current.refresh_token_enc) return null
    let tokens: OuraTokens
    try {
      tokens = await refreshTokens(fetchFn, config, decryptSecret(current.refresh_token_enc, key), now)
    } catch (error) {
      if (error instanceof OuraAuthError) {
        // Another request may have rotated the token first: use theirs if so.
        const latest = await store.getConnection(userId)
        if (latest && latest.refresh_token_enc !== current.refresh_token_enc) return latest
        return null
      }
      throw error
    }
    const next = {
      access_token_enc: encryptSecret(tokens.accessToken, key),
      refresh_token_enc: tokens.refreshToken ? encryptSecret(tokens.refreshToken, key) : null,
      token_expires_at: tokens.expiresAt.toISOString(),
    }
    const won = await store.rotateTokens(userId, current.refresh_token_enc, next)
    if (won) return { ...current, ...next }
    return store.getConnection(userId)
  }

  async function needsReconnect(): Promise<SyncResult> {
    await store.recordSync(userId, { last_error: RECONNECT_MESSAGE })
    return { status: 'needs_reconnect' }
  }

  try {
    if (new Date(connection.token_expires_at).getTime() - now.getTime() < REFRESH_MARGIN_MS) {
      const refreshed = await refresh(connection)
      if (!refreshed) return await needsReconnect()
      connection = refreshed
    }

    const start = dateKey(new Date(now.getTime() - (SYNC_DAYS - 1) * 86_400_000))
    const end = dateKey(now)
    const pull = (token: string) => Promise.all([
      fetchDaily<{ day: string; score?: number | null }>(fetchFn, token, 'daily_sleep', start, end),
      fetchDaily<{ day: string; score?: number | null }>(fetchFn, token, 'daily_readiness', start, end),
      fetchDaily<{ day: string; score?: number | null; steps?: number | null; active_calories?: number | null }>(fetchFn, token, 'daily_activity', start, end),
    ])

    let collections
    try {
      collections = await pull(decryptSecret(connection.access_token_enc, key))
    } catch (error) {
      if (!(error instanceof OuraAuthError)) throw error
      const refreshed = await refresh(connection)
      if (!refreshed) return await needsReconnect()
      collections = await pull(decryptSecret(refreshed.access_token_enc, key))
    }

    const rows = toMetricRows(userId, ...collections)
    await store.upsertMetrics(rows)
    const syncedAt = now.toISOString()
    await store.recordSync(userId, { last_synced_at: syncedAt, last_error: null })
    return { status: 'ok', days: rows.length, syncedAt }
  } catch (error) {
    if (error instanceof OuraAuthError) return await needsReconnect()
    await store.recordSync(userId, { last_error: FAILED_MESSAGE }).catch(() => undefined)
    return { status: 'error' }
  }
}
