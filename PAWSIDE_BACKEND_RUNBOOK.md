# Pawside backend activation runbook

This runbook applies only to `D:\Pawside`. It never targets Morrow and never assumes that the former Supabase project still exists.

## Safety boundary

- Use a newly created, empty Pawside Supabase project.
- Keep project refs, database passwords, access tokens, and service-role keys out of Git.
- Do not expose a service-role key through a `NEXT_PUBLIC_*` variable.
- Automatic seed execution is disabled in `supabase/config.toml`.
- Never run `supabase db reset --linked` against production. For this rebuild, a failed pre-production attempt should be discarded or forward-fixed rather than destructively reset after real users exist.

## Gate 0 — source package

```powershell
npm.cmd run backend:preflight
npm.cmd run media:validate
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
```

Expected pre-database status is `READY_TO_APPLY / HOLD`. That means the assets are complete but PostgreSQL has not executed them.

## Gate 1 — local PostgreSQL replay

Prerequisites: a current Supabase CLI and a running Docker-compatible runtime. The local Supabase stack is development-only.

```powershell
supabase start
supabase db reset --local --no-seed
supabase test db
supabase db lint --local
```

Retain the command output. A clean reset proves that every migration can be replayed in order. It does not prove remote activation.

## Gate 2 — new remote project dry run

The operator must first confirm the exact new Pawside project ref. No historical ref should be reused by assumption.

```powershell
supabase login
supabase link --project-ref <NEW_PAWSIDE_PROJECT_REF>
supabase migration list
supabase db push --dry-run
```

Review the dry-run output before approving the write. Then apply migrations:

```powershell
supabase db push
```

Do not use `--include-seed` for production.

## Gate 3 — reference data and SQL contracts

Set `PAWSIDE_DATABASE_URL` only in the current shell or a secret manager; never commit it.

```powershell
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_food_data.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_canonical_patch.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_portion_templates.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pawside_backend_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workout_guide_media_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pawside_performance_contract.sql
```

The chunked `seed_part*` and `seeds/batches/*` files are alternatives to `seed_food_data.sql`; never run both paths.

## Gate 4 — Auth and RLS evidence

In the new Supabase project, set the deployed Pawside origin as the Auth Site URL and allow its `/auth/callback` URL. Configure production SMTP before public activation.

Use two new test users and retain evidence for:

1. Signup email returns through `/auth/callback`, creates a session, and creates exactly one profile shell.
2. Each user can CRUD only their own workout, food, body, weekly, and AI-cache records.
3. Cross-user reads and writes fail even when the other row ID is known.
4. Anonymous access cannot read private tables; public food reference reads still work.
5. Password reset completes and replaces the session correctly.

## Gate 5 — product smoke test

Verify signup, login, onboarding, workout logging, food logging/search, body metrics, history, weekly summary, export, AI fallback, and `/training/today` against the rebuilt backend.

Pawside Method remains unavailable until its source-of-truth Tracking dataset, Push/Pull/Legs mappings, atomic initialization, and progression/recovery acceptance cases are approved. Journal activation must not fabricate those states.

## Decision labels

- `READY_TO_APPLY / HOLD`: files and static checks pass; database execution is missing.
- `BACKEND_GO / PRODUCT_HOLD`: migrations, seeds, contracts, Auth, and RLS pass; product smoke test is incomplete.
- `JOURNAL_GO / METHOD_NO_GO`: existing Pawside journal passes; Method truth data is still absent.
- `PUBLIC_GO`: all gates pass, dependency advisories are resolved or explicitly accepted, and production monitoring/rollback ownership is assigned.
