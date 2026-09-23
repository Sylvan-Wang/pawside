# Pawside Supabase rebuild

This directory is the rebuild source of truth for a **new Pawside Supabase project**. It does not recover or modify the missing historical project, and it contains no Morrow assets.

`config.toml` is local-only and contains no remote project reference. Automatic
seeding is disabled so a reset or push cannot silently load the large reference
dataset. Use `PAWSIDE_BACKEND_RUNBOOK.md` for the gated activation sequence.

## What is rebuildable now

- Current Pawside compatibility tables: profile, workout, food, body metrics, weekly cache, AI plan, and AI-generated content.
- Structured food reference and normalized nutrition tables.
- Auth signup to profile-shell trigger.
- Row Level Security for all user-owned records.
- Pawside Method reference, enrollment, progression, and prescription foundation.

The Method seed remains `draft`. Profile onboarding is deliberately independent: it can complete the existing Pawside journal setup while returning Method `unavailable`. No enrollment, cycle, progression state, or prescription is fabricated before the authoritative Method Tracking dataset and atomic initialization workflow are supplied.

## Migration order

`supabase db push` applies these files in order:

1. `migrations/20260413000000_v3_food_schema.sql`
2. `migrations/20260904000100_legacy_compatibility_schema.sql`
3. `migrations/20260904000200_method_foundation.sql`
4. `migrations/20260906000100_pawside_backend_activation_hardening.sql`
5. `migrations/20260906000200_workout_guide_media_foundation.sql`
6. `migrations/20260907000100_pawside_performance_advisor_hardening.sql`
7. `migrations/20260909000100_method_source_schema.sql`
8. `migrations/20260909000200_method_release_governance.sql`
9. `migrations/20260909000300_method_evidence_and_policy.sql`
10. `migrations/20260909000400_method_release_security.sql`
11. `migrations/20260909000500_workout_guide_method_catalog.sql`
12. `migrations/20260909000600_method_v1_2_validated_draft.sql`
13. `migrations/20260910000100_method_enrollment_foundation.sql`

Migration 12 creates a `validated`, `internal_beta` v1.2 release with Runtime
Gate passed and Strict Gate blocked. It does not activate the release or create
user enrollments.

Migration 13 adds the lightweight capability profile and release-pinned
Enrollment initializer. It creates no enrollment unless the user has completed
both onboarding layers and a Runtime-gate-passed Method release is already
`active`. Non-full-gym equipment remains saved but returns an explicit review
state instead of inventing substitutions.

Use a newly created Supabase project. Do not link this checkout to the missing historical project reference.

## Reference food seed

After migrations succeed, load one complete seed path only:

```powershell
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_food_data.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_canonical_patch.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/seed_portion_templates.sql
```

`seed_part1_*`, `seed_part2_*`, `seed_part3_*`, and `seeds/batches/*` are alternative chunked forms of the same bulk dataset. Do not run them after `seed_food_data.sql`.

## Verification

Run the source-only preflight before attempting PostgreSQL:

```powershell
npm.cmd run backend:preflight
```

`READY_TO_APPLY / HOLD` is the correct result when the CLI, Docker, or psql is
missing. It is not a backend pass.

Run the catalog contract after migrations (and again after seeding):

```powershell
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pawside_backend_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workout_guide_media_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pawside_performance_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/method_release_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/method_import_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/method_v1_2_draft_contract.sql
psql "$env:PAWSIDE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/method_enrollment_contract.sql
```

The performance contract checks the seven Advisor-requested foreign-key indexes
and confirms that the three food ownership policies still use the statement-level
`(select auth.uid())` form. Re-run Supabase Performance Advisor after applying
the migration; the contract proves the intended database shape, not a measured
latency improvement.

## Exercise media

Pawside pins `@bryllim/workout-guide` at `1.0.0`. Runtime frame URLs are generated from the package manifest and the versioned jsDelivr path; Supabase stores only the Pawside exercise ID, provider slug, version, mapping status, source, license, and attribution.

The package code is MIT. Exercise frames are CC BY-SA 4.0: preserve the displayed Everkinetic/Bryl Lim credit and license link, indicate changes, and keep any modified visual assets under CC BY-SA 4.0. Original CDN frames are not copied into Supabase Storage.

The Canonical Method catalog contains 15 exercise identities. Thirteen have a
pinned workout-guide mapping: seven confirmed and six visible candidates.
`单手绳索下拉` and `单手器械划船` remain intentionally unmapped because the
provider catalog has no exact-enough match. Candidate mappings never count as
Method evidence and must not silently become confirmed.

Then verify these live cases with two newly registered users:

1. Each signup creates exactly one `user_profiles` row.
2. User A can create/read/update/delete only User A workout, food, body, and cached AI records.
3. User B cannot read or mutate User A records, even when given their IDs.
4. Anonymous access cannot read user-owned tables; food reference search remains readable.
5. Empty optional workout exercises and body custom metrics save successfully.
6. Body metrics preserve `hip_cm`, `left_calf_cm`, and `right_calf_cm`.
7. Food search returns nutrition joins after the reference seed is loaded.
8. Method endpoints report unavailable while the Method row is `draft`; they must not fabricate enrollment or prescription state.

## App environment

Replace the local public Supabase URL and anon key with values from the new project. A service-role key is not required by the current application and must not be exposed through a `NEXT_PUBLIC_*` variable.

Set the deployed Pawside origin as the Supabase Auth Site URL and allow
`<origin>/auth/callback` as a redirect URL. The signup client now distinguishes
an immediate session from email-confirmation-pending and the callback exchanges
the PKCE code for the cookie-backed session. Configure production SMTP before
public activation.

Activation evidence is complete only after migration output, the SQL verification result, and the two-user RLS cases are retained together. A TypeScript build alone does not prove backend activation.
