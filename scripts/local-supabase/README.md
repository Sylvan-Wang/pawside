# Local Supabase stand-in (sandbox only)

For machines with no Docker / Supabase CLI. It gives the integration tests and the browser check a real
Postgres 16 + PostgREST, so service code runs through `supabase-js` with row-level security on.
It is **not** Supabase: no Auth service, Storage or Realtime. `auth.users` and `auth.uid()` are stubbed in
`stub.sql`, and `proxy.mjs` answers `/auth/v1/user` for any well-formed token without verifying it.
Never point it at anything that holds real data.

## Pieces

| File | What it is |
|---|---|
| `stub.sql` | Roles (`anon`, `authenticated`, `service_role`, `authenticator`), `auth.users`, `auth.uid()` |
| `proxy.mjs` | Maps `/rest/v1/*` to PostgREST and answers `/auth/v1/user` (so the Next server can tell who is signed in) |
| `fake-openai.mjs` | A rule-based stand-in for the Responses endpoint. **Only** to drive the UI without an API key: it understands a few fixed phrasings and says nothing about how a real model reads people |
| `jwt.mjs` | HS256 token minting for the harness |
| `e2e-browser.mjs` | Drives real Chromium at phone size through the whole chat path |

## Setup

1. Start Postgres 16, create a database (default `pawtest`), apply `stub.sql`, every file in
   `supabase/migrations/` in order, then the seeds `supabase/seeds/seed_food_data.sql`,
   `seed_canonical_patch.sql`, `seed_portion_templates.sql`.
2. Run PostgREST 12 with `db-anon-role = "anon"`, `jwt-secret` equal to `PAWSIDE_IT_JWT_SECRET`
   (default in the harness: see `tests/integration/harness.ts`), `db-extra-search-path = "public, extensions"`,
   connecting as role `authenticator`.
3. `node scripts/local-supabase/proxy.mjs` (port 54331).
4. SQL contracts: `psql -v ON_ERROR_STOP=1 -f supabase/tests/<file>.sql` for each file.
5. Integration tests: `PAWSIDE_IT=1 npx vitest run tests/integration`
   (they skip themselves otherwise, so the normal `npm test` needs none of this).
6. Browser check: build the app with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331`, the matching anon token,
   `OPENAI_BASE_URL=http://127.0.0.1:54340`, run `node scripts/local-supabase/fake-openai.mjs`, start the app, then
   `node scripts/local-supabase/e2e-browser.mjs <screenshot dir>`. The session cookie name is `sb-127-auth-token`
   because the Supabase URL's host is `127.0.0.1`.
   Set `NO_PROXY=127.0.0.1,localhost` if your shell has an HTTP proxy, or the app cannot reach the stand-ins.

## Things this harness found

- PostgREST 12.2.3 retries a transaction that fails with SQLSTATE `40001` and never answers. The raise in
  `replace_food_log_canonical_v1` was one; see `supabase/migrations/20261023000200_food_edit_conflict_status.sql`.
  Use a `PTnnn` code (for example `PT409`) when a function should answer with an HTTP status.
