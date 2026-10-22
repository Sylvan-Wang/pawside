# Local Supabase stand-in (sandbox only)

For machines with no Docker / Supabase CLI. It gives the integration tests a real
Postgres 16 + PostgREST so service code runs through `supabase-js` with RLS on.
It is NOT Supabase: no Auth service, Storage or Realtime. `auth.users` and
`auth.uid()` are stubbed in `stub.sql`.

1. Start Postgres 16 and create a database (default `pawtest`), then apply `stub.sql`,
   every file in `supabase/migrations/` in order, and the seeds
   (`seed_food_data`, `seed_canonical_patch`, `seed_portion_templates`).
2. Run PostgREST 12 with `db-anon-role = anon`, `jwt-secret` equal to `PAWSIDE_IT_JWT_SECRET`
   and `db-extra-search-path = "public, extensions"`; connect as role `authenticator`.
3. `node scripts/local-supabase/proxy.mjs` (maps `/rest/v1/*` to PostgREST).
4. `PAWSIDE_IT=1 npx vitest run tests/integration`.

The integration tests skip themselves unless `PAWSIDE_IT=1`, so the normal
`npx vitest run` does not need any of this.
