/**
 * Local database fallback for machines without the Supabase CLI, Docker, or a
 * PostgreSQL client (the CI `database` job uses `supabase db start` instead).
 *
 * It replays every `supabase/migrations/*.sql` in filename order against an
 * in-process PGlite database, then runs every `supabase/tests/*.sql` contract.
 * The bootstrap stubs `auth.users`, `auth.uid()`, and the Supabase roles exactly
 * like `docs/method-import/tools/local-replay.sh`, which is what makes the
 * permission assertions in the contracts meaningful: PGlite grants nothing to
 * `authenticated` by default, so a missing grant shows up here first.
 *
 * Usage: node scripts/local-pglite-replay.mjs
 * Exit code is non-zero on the first failing migration or contract.
 *
 * Known limitation: PGlite cannot load `pgcrypto`, so
 * `create extension if not exists pgcrypto` is stripped and `gen_random_uuid()`
 * is taken from core. Production migrations are never modified.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const db = new PGlite()
const bootstrap = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin bypassrls;
create schema auth;
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant select, insert, update, delete on auth.users to service_role, supabase_auth_admin;
`

try {
  await db.exec(bootstrap)
  const migrationNames = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()
  for (const name of migrationNames) {
    try {
      const sql = (await readFile(join('supabase/migrations', name), 'utf8'))
        // PGlite provides gen_random_uuid() in core but does not package the
        // pgcrypto control file. Production migrations remain unchanged.
        .replace(/create extension if not exists pgcrypto\s*;/ig, '')
      await db.exec(sql)
      console.log(`PASS migration ${name}`)
    } catch (error) {
      console.error(`FAIL migration ${name}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
      break
    }
  }

  if (!process.exitCode) {
    const contractNames = (await readdir('supabase/tests')).filter((name) => name.endsWith('.sql')).sort()
    for (const name of contractNames) {
      try {
        await db.exec(await readFile(join('supabase/tests', name), 'utf8'))
        console.log(`PASS contract ${name}`)
      } catch (error) {
        console.error(`FAIL contract ${name}: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
        break
      }
    }
  }
} finally {
  await db.close()
}
