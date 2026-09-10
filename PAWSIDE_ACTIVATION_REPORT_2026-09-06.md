# Pawside activation report — 2026-09-06

## Scope and evidence boundary

- Scope is `D:\Pawside` only.
- The former Supabase backend is treated as unavailable and non-recoverable.
- No remote database was created, linked, migrated, or mutated during this audit.
- Statements in older local planning documents about a newly created project are historical notes, not current reachability evidence.

## Asset inventory

### Application

- Next.js 16 / React 19 application with 15 page routes and 10 established API route files.
- Supabase browser/server client factories, email/password authentication, middleware session refresh, profile onboarding, workout logging, food logging, body metrics, history, weekly summary, export, and AI daily review paths.
- Additional uncommitted Pawside 2.0 work adds onboarding, current Method, Method progress, and today-training API contracts plus Home/onboarding UI changes.

### Database reconstruction assets

- `20260413000000_v3_food_schema.sql`: 7 structured food/nutrition tables with RLS.
- `20260904000100_legacy_compatibility_schema.sql`: 7 tables required by the current UI, Auth-to-profile trigger, ownership RLS, indexes, and timestamp triggers.
- `20260904000200_method_foundation.sql`: 13 Method/reference/enrollment/progression/prescription tables and read policies. The Method seed is deliberately `draft`.
- `20260906000100_pawside_backend_activation_hardening.sql`: client-contract corrections, explicit privileges, Auth trigger hardening, and normalized nutrition RLS hardening.
- `supabase/tests/pawside_backend_contract.sql`: post-migration catalog, column, cache-key, trigger, privilege, and RLS checks.

The ordered migration set now describes 27 application tables from a fresh Supabase database.

### Reference data

- Clean CSV assets contain 1,697 canonical food rows and 1,697 nutrition rows.
- `seed_food_data.sql` is the complete SQL seed path.
- `seed_canonical_patch.sql` and `seed_portion_templates.sql` add canonical aliases and common portions.
- `seed_part*` and `seeds/batches/*` are alternative chunked forms and must not be run in addition to the complete seed.

### Product and planning evidence

- `CURRENT_STATE.md`, `GAP_MAP.md`, `IMPLEMENTATION_PLAN.md`, and `OPEN_QUESTIONS.md` preserve the Phase 0 audit and staged Pawside 2.0 plan.
- The final Method Tracking dataset is absent. Pull/Legs mappings, initial stages, set prescriptions, progression transitions, and recovery rule thresholds remain unconfirmed.
- No Storage bucket or media migration exists. Body Capture therefore remains unimplemented.

## Defects found and addressed in this audit

- The body client writes `hip_cm`, `left_calf_cm`, and `right_calf_cm`; the compatibility schema previously used `hips_cm` and omitted both calf fields.
- The current client sends `null` for an empty workout exercise list and empty custom body metrics; the schema previously rejected those values.
- Fresh-project grants depended on Supabase dashboard defaults instead of being explicit in the migration.
- The Auth profile trigger used a writable `public` search path; the hardening migration changes it to an empty search path and restricts direct execution.

## Verification completed

- TypeScript: PASS (`tsc --noEmit --incremental false`).
- ESLint: PASS (`eslint .`).
- Patch whitespace check: PASS.
- Static source-to-schema contract review: PASS after the hardening migration.
- PostgreSQL migration execution: NOT RUN; this machine has no Supabase CLI, Docker, or `psql`.
- Two-user RLS behavior: NOT RUN; no reachable target project was used.
- Production dependency advisory refresh: NOT RUN; outbound npm metadata disclosure was not authorized.

## Activation decision

| Layer | Status | Meaning |
|---|---|---|
| Source/build baseline | `GO` | Current TypeScript and ESLint checks pass. |
| Fresh database package | `READY_TO_APPLY / HOLD` | Migrations, seeds, and a post-check exist, but have not executed against PostgreSQL. |
| Auth and private-data isolation | `HOLD` | Trigger and RLS are defined; live signup and cross-user tests are still required. |
| Existing journal features | `READY_AFTER_DB / HOLD` | Profile onboarding is now independent of Method, but the rebuilt database and live flows remain unverified. |
| Pawside Method execution | `NO_GO` | The authoritative Method Tracking rules and atomic enrollment/prescription initialization are missing. |
| Public production activation | `NO_GO` | No verified backend, live RLS evidence, production seed evidence, or completed security gate exists. |

## Shortest viable activation paths

### Path A — restore the existing Pawside journal first

1. Create a new Supabase project and apply all four migrations.
2. Load the complete food seed and patches.
3. Run the database contract and two-user RLS cases.
4. Replace local public Supabase URL/anon values with the new project values.
5. Profile onboarding is now independent of Method enrollment and labels the Method as unavailable; verify this behavior against the new backend.
6. Smoke-test signup, login, workout, food, body, history, weekly, export, and AI fallback.

This path is the fastest route to a usable Pawside product. The code-side onboarding change is complete; database deployment and live evidence remain outstanding.

### Path B — activate Pawside Method end to end

Complete Path A, then supply the authoritative Method Tracking dataset, seed all three splits and versioned rules, implement the atomic onboarding transaction, and verify prescription/progression/recovery behavior. This is the intended full product path but is currently blocked by missing source-of-truth data.

## Evidence required to change public status to GO

- Successful migration log from a newly created Pawside Supabase project.
- Successful `pawside_backend_contract.sql` output after seed load.
- Two distinct test-user evidence for own-row CRUD and cross-user denial.
- Auth signup/profile-trigger and password recovery evidence.
- End-to-end evidence for all retained journal modules.
- A fresh production dependency audit and resolution/acceptance of reported advisories.
- For Method activation: approved Method Tracking version plus deterministic prescription/progression acceptance cases.
