import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

/**
 * Integration harness: real Postgres + PostgREST (scripts/local-supabase/README.md),
 * a real supabase-js client per user with row-level security on. Only the model
 * is scripted. Skipped unless PAWSIDE_IT=1.
 */

export const IT_ENABLED = process.env.PAWSIDE_IT === '1'

const REST_URL = process.env.PAWSIDE_IT_URL ?? 'http://127.0.0.1:54331'
const JWT_SECRET = process.env.PAWSIDE_IT_JWT_SECRET ?? 'pawside-local-test-secret-0123456789abcdef'
const PSQL = (process.env.PAWSIDE_IT_PSQL ?? 'psql -h /tmp/pgdata -p 54329 -U postgres -d pawtest').split(' ')

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function mintJwt(sub: string | null, role: 'anon' | 'authenticated' = 'authenticated'): string {
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ aud: 'authenticated', role, ...(sub ? { sub } : {}), exp: Math.floor(Date.now() / 1000) + 3600 })
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

/** Runs SQL as the database owner (setup and assertions, bypassing RLS). */
export function sql(statement: string): string {
  return execFileSync(PSQL[0], [...PSQL.slice(1), '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-q', '-c', statement], { encoding: 'utf8' }).trim()
}

export function clientFor(userId: string, fetchImpl?: typeof fetch): SupabaseClient {
  return createClient(REST_URL, mintJwt(null, 'anon'), {
    global: { headers: { Authorization: `Bearer ${mintJwt(userId)}` }, ...(fetchImpl ? { fetch: fetchImpl } : {}) },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface TestUser {
  id: string
  client: SupabaseClient
}

export function createTestUser(options: { feature?: boolean } = {}): TestUser {
  const id = randomUUID()
  sql(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','it-${id}@pawside.test','',now(),'{}','{}',now(),now())`)
  if (options.feature !== false) sql(`insert into public.user_features (user_id, feature_key) values ('${id}','coach_chat')`)
  return { id, client: clientFor(id) }
}

export function deleteTestUser(id: string): void {
  sql(`delete from auth.users where id = '${id}'`)
}

export function count(table: string, where: string): number {
  return Number(sql(`select count(*) from public.${table} where ${where}`))
}
