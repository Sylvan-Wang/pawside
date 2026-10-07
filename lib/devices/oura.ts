import { SITE_URL } from '@/lib/site/content'

/**
 * Oura Cloud API v2 client (OAuth2 authorization-code flow), read-only, `daily` scope only.
 *
 * DISPLAY ONLY. Oura's API agreement forbids giving Oura data (or anything derived from it)
 * to an AI model, so nothing in lib/devices may be imported by AI code and the data may only
 * be shown to the person it belongs to. tests/devices/no-ai.test.ts enforces the import side.
 */
export const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize'
export const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'
export const OURA_API_BASE = 'https://api.ouraring.com'
/** The only scope we ask for: daily sleep, readiness and activity summaries. */
export const OURA_SCOPE = 'daily'

export type FetchFn = typeof fetch

export interface OuraConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function ouraConfig(env: Record<string, string | undefined> = process.env): OuraConfig | null {
  const clientId = env.OURA_CLIENT_ID?.trim()
  const clientSecret = env.OURA_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri: env.OURA_REDIRECT_URI?.trim() || `${SITE_URL}/api/devices/oura/callback`,
  }
}

export function buildAuthorizeUrl(config: OuraConfig, state: string): string {
  const url = new URL(OURA_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', OURA_SCOPE)
  url.searchParams.set('state', state)
  return url.toString()
}

/** The token or authorization is no longer valid: the person must connect again. */
export class OuraAuthError extends Error {}

export interface OuraTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string[]
}

async function tokenRequest(
  fetchFn: FetchFn,
  config: OuraConfig,
  params: Record<string, string>,
  now: Date,
): Promise<OuraTokens> {
  const response = await fetchFn(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }).toString(),
  })
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !payload || typeof payload.access_token !== 'string') {
    // 400/401 on a token request means the grant or refresh token is dead.
    if (response.status === 400 || response.status === 401) throw new OuraAuthError('oura rejected the grant')
    throw new Error(`oura token request failed (${response.status})`)
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    scopes: typeof payload.scope === 'string' && payload.scope ? payload.scope.split(/[\s,]+/) : [OURA_SCOPE],
  }
}

export function exchangeCode(fetchFn: FetchFn, config: OuraConfig, code: string, now = new Date()) {
  return tokenRequest(fetchFn, config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }, now)
}

export function refreshTokens(fetchFn: FetchFn, config: OuraConfig, refreshToken: string, now = new Date()) {
  return tokenRequest(fetchFn, config, { grant_type: 'refresh_token', refresh_token: refreshToken }, now)
}

const MAX_PAGES = 10

/** One daily collection (daily_sleep, daily_readiness, daily_activity), following pagination. */
export async function fetchDaily<T>(
  fetchFn: FetchFn,
  accessToken: string,
  collection: 'daily_sleep' | 'daily_readiness' | 'daily_activity',
  startDate: string,
  endDate: string,
): Promise<T[]> {
  const items: T[] = []
  let nextToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${OURA_API_BASE}/v2/usercollection/${collection}`)
    url.searchParams.set('start_date', startDate)
    url.searchParams.set('end_date', endDate)
    if (nextToken) url.searchParams.set('next_token', nextToken)
    const response = await fetchFn(url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } })
    if (response.status === 401) throw new OuraAuthError('oura rejected the access token')
    if (!response.ok) throw new Error(`oura ${collection} failed (${response.status})`)
    const payload = (await response.json()) as { data?: T[]; next_token?: string | null }
    items.push(...(payload.data ?? []))
    nextToken = payload.next_token ?? null
    if (!nextToken) break
  }
  return items
}

export interface DailyMetricRow {
  user_id: string
  provider: 'oura'
  day: string
  sleep_score: number | null
  readiness_score: number | null
  activity_score: number | null
  steps: number | null
  active_calories: number | null
}

interface WithScore { day: string; score?: number | null }
interface ActivityDay extends WithScore { steps?: number | null; active_calories?: number | null }

const score = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null
const count = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null

/** Merge the three collections into one row per day. Missing values stay null (never 0). */
export function toMetricRows(userId: string, sleep: WithScore[], readiness: WithScore[], activity: ActivityDay[]): DailyMetricRow[] {
  const days = new Map<string, DailyMetricRow>()
  const row = (day: string): DailyMetricRow => {
    let existing = days.get(day)
    if (!existing) {
      existing = { user_id: userId, provider: 'oura', day, sleep_score: null, readiness_score: null, activity_score: null, steps: null, active_calories: null }
      days.set(day, existing)
    }
    return existing
  }
  for (const item of sleep) if (item.day) row(item.day).sleep_score = score(item.score)
  for (const item of readiness) if (item.day) row(item.day).readiness_score = score(item.score)
  for (const item of activity) {
    if (!item.day) continue
    const target = row(item.day)
    target.activity_score = score(item.score)
    target.steps = count(item.steps)
    target.active_calories = count(item.active_calories)
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
}
