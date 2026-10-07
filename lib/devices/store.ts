import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyMetricRow } from './oura'

export interface ConnectionRow {
  user_id: string
  provider: 'oura'
  access_token_enc: string
  refresh_token_enc: string | null
  token_expires_at: string
  scopes: string[]
  connected_at: string
  last_synced_at: string | null
  last_error: string | null
}

export type ConnectionSave = Pick<ConnectionRow, 'user_id' | 'provider' | 'access_token_enc' | 'refresh_token_enc' | 'token_expires_at' | 'scopes'>

/** Everything the sync needs from storage, so tests can run it against memory. */
export interface DeviceStore {
  getConnection(userId: string): Promise<ConnectionRow | null>
  saveConnection(row: ConnectionSave): Promise<void>
  /** Replace tokens only if the stored refresh token is still the one we used (refresh tokens are single-use). */
  rotateTokens(userId: string, expectedRefreshEnc: string | null, next: Pick<ConnectionSave, 'access_token_enc' | 'refresh_token_enc' | 'token_expires_at'>): Promise<boolean>
  recordSync(userId: string, patch: { last_synced_at?: string; last_error: string | null }): Promise<void>
  upsertMetrics(rows: DailyMetricRow[]): Promise<void>
  /** Disconnect: remove the credentials and every synced metric for this person. */
  deleteAll(userId: string): Promise<void>
}

const PROVIDER = 'oura'

/** Service-role implementation. Only server code may construct this. */
export function supabaseDeviceStore(admin: SupabaseClient): DeviceStore {
  return {
    async getConnection(userId) {
      const { data, error } = await admin.from('device_connections').select('*').eq('user_id', userId).eq('provider', PROVIDER).maybeSingle()
      if (error) throw new Error(`device_connections read failed: ${error.message}`)
      return (data as ConnectionRow | null) ?? null
    },
    async saveConnection(row) {
      const { error } = await admin.from('device_connections').upsert(
        { ...row, last_error: null, last_synced_at: null, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,provider' },
      )
      if (error) throw new Error(`device_connections write failed: ${error.message}`)
    },
    async rotateTokens(userId, expectedRefreshEnc, next) {
      let query = admin.from('device_connections').update({ ...next, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', PROVIDER)
      query = expectedRefreshEnc === null ? query.is('refresh_token_enc', null) : query.eq('refresh_token_enc', expectedRefreshEnc)
      const { data, error } = await query.select('user_id')
      if (error) throw new Error(`device_connections rotate failed: ${error.message}`)
      return (data?.length ?? 0) > 0
    },
    async recordSync(userId, patch) {
      const { error } = await admin.from('device_connections').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', PROVIDER)
      if (error) throw new Error(`device_connections update failed: ${error.message}`)
    },
    async upsertMetrics(rows) {
      if (rows.length === 0) return
      const { error } = await admin.from('device_daily_metrics').upsert(
        rows.map((row) => ({ ...row, synced_at: new Date().toISOString() })),
        { onConflict: 'user_id,provider,day' },
      )
      if (error) throw new Error(`device_daily_metrics write failed: ${error.message}`)
    },
    async deleteAll(userId) {
      const metrics = await admin.from('device_daily_metrics').delete().eq('user_id', userId).eq('provider', PROVIDER)
      if (metrics.error) throw new Error(`device_daily_metrics delete failed: ${metrics.error.message}`)
      const connection = await admin.from('device_connections').delete().eq('user_id', userId).eq('provider', PROVIDER)
      if (connection.error) throw new Error(`device_connections delete failed: ${connection.error.message}`)
    },
  }
}
