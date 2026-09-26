# Pawside｜Phase Verification Matrix

**Purpose:** the exact command batch that must pass before any phase is promoted from `CODE_COMPLETE` to `LOCAL_VALIDATED`, plus the gates that cannot be satisfied in the current environment.

**Environment note (verified 2026-09-26):** the `workspace-write` sandbox cannot spawn a process at all (`SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\Pawside)`). Shell works only under `danger-full-access`. On Windows use `npm.cmd` / `npx.cmd` — `npm.ps1` / `npx.ps1` are blocked by execution policy.

---

# 1. Runnable now (no database required)

| # | Gate | Command | Phase 0 result |
|---|---|---|---|
| 1 | TypeScript | `npx.cmd tsc --noEmit --incremental false` | **PASS** (exit 0, no diagnostics) |
| 2 | ESLint | `npx.cmd eslint .` | **PASS** (exit 0, no findings) |
| 3 | Full test suite | `npx.cmd vitest run` | **PASS** (22 files / 126 tests) |
| 4 | Production build | `npm.cmd run build` | **PASS** (exit 0, all routes emitted) |
| 5 | Macro deterministic tests | `npx.cmd vitest run tests/nutrition/macro-targets.test.ts` | **PASS** (11 tests) |
| 6 | Onboarding target contract | `npx.cmd vitest run tests/nutrition/onboarding-target-layer.test.ts` | **PASS** (10 tests) |

Regression baseline — before the Phase 1 Target-layer change: **20 files / 105 tests**. After: **22 files / 126 tests**, zero failures and zero previously-passing tests removed.

---

# 2. Blocked — no local database available

**Blocker:** no Supabase CLI and no Docker in this environment, local ports `54321/54322/54323` not listening, and `.env.local` points at a **remote** project (`https://sbwevlhzqujrtucppacl.supabase.co`) rather than the configured local project `pawside`. Running app-level flows would write to a shared remote database, which is out of bounds this round.

| # | Gate | Status | Why blocked | How to satisfy |
|---|---|---|---|---|
| 7 | Migration local apply | **BLOCKED** | no CLI / no Docker | `npx supabase start` then `npx supabase db reset` |
| 8 | Fresh DB replay | **BLOCKED** | same | `npx supabase db reset` on a disposable project |
| 9 | Onboarding closed-loop (save → DB → read back) | **BLOCKED** | needs authenticated E2E | run against disposable DB with a test user |
| 10 | Settings blank → NULL closed-loop | **BLOCKED** | same | same |
| 11 | Fixed-fixture baseline drift | **BLOCKED** | needs a seeded fixture DB | seed fixture, run the §5 template in the Phase 0 map |

Until 7–11 run, `DB_MIGRATION_READY` and `REAL_FIXTURE_VALIDATED` must stay `BLOCKED`, and the round must not be called `PRODUCTION_READY`.

---

# 3. SQL assertions to run once a DB exists

These are the checks that protect the "unverified" surfaces. They are written out so they can be executed verbatim.

## 3.1 Migration applies at all

The current `20260910000100_method_enrollment_foundation.sql:221-232` source
places `p_join_method boolean default true` last. The earlier `42P13` claim was
based on a stale signature and is not a confirmed defect. Fresh replay remains
required because source inspection alone cannot prove migration readiness.

```sql
-- After a fresh replay, assert the v2 function exists with the correct arity.
select p.proname,
       pg_get_function_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('complete_phase2_onboarding', 'complete_phase2_onboarding_v2')
order by p.proname;

-- v2 must accept a NULL calorie target and persist NULL (not 2000).
select public.complete_phase2_onboarding_v2(
  'gain_muscle', 'male', 178, 72, 'kg',
  'some_experience', 'six_to_fifteen', 'full_gym', 60,
  null,          -- p_daily_calorie_target
  null,          -- p_weekly_workout_target
  false          -- p_join_method
);

select daily_calorie_target, weekly_workout_target, weight_kg, reference_weight_kg
from public.user_profiles;
-- EXPECT: daily_calorie_target IS NULL, weekly_workout_target IS NULL,
--         weight_kg = 72, reference_weight_kg = 72
```

## 3.2 Bound guards

```sql
-- EXPECT: 22023 for each of these
select public.complete_phase2_onboarding_v2(
  'gain_muscle','male',178,72,'kg','some_experience','six_to_fifteen','full_gym',60,
  499, null, false);                     -- below calorie floor-guard

select public.complete_phase2_onboarding_v2(
  'gain_muscle','male',178,72,'kg','some_experience','six_to_fifteen','full_gym',60,
  null, 22, false);                      -- above weekly guard

-- EXPECT: success, and must NOT be rejected as "dangerous"
select public.complete_phase2_onboarding_v2(
  'lose_fat','female',165,60,'kg','some_experience','six_to_fifteen','full_gym',60,
  1200, 3, false);                       -- AI Patch §14: no universal calorie floor
```

## 3.3 Onboarding overwrite semantics (pre-existing, recorded)

```sql
-- Re-submitting onboarding overwrites weight_kg with the onboarding entry value.
-- Recorded as origin = pre_existing; NOT fixed this round.
select weight_kg, reference_weight_kg from public.user_profiles;
```

Expected current behaviour: both equal the latest onboarding submission, so a
prior `body_metrics` measurement does not become `weight_kg`. Macro derivation
reads latest `body_metrics.weight_kg` first, so this does not corrupt generated
recommendations — hence `FOLLOW_UP`, not a blocker.

---

# 4. Deterministic assertions already covered by unit tests

These were listed as required verification and are now enforced in code:

| Assertion | Covered by |
|---|---|
| blank calorie target → NULL | `onboarding-target-layer.test.ts` "omitted / null / empty string" |
| blank weekly target → NULL | same |
| `0 != missing` | "rejects 0 instead of silently reading it as not set" |
| `protein = weight × 1.6` | `macro-targets.test.ts` "derives protein…" |
| `fat = kcal × 0.25 / 9` | same |
| `carb = remainder / 4` | same |
| negative carb → `needs_review` | "returns needs_review when the calorie target cannot carry the protein load" |
| missing target → `insufficient_data` | "returns insufficient_data for a missing calorie target" |
| missing weight → `insufficient_data` | "returns insufficient_data for a missing weight" |
| no universal calorie floor encoded | "encodes no lower safety floor beyond the tamper bound" |
| macro split conserves target calories | "keeps the macro split summing back to the calorie target" |

---

# 5. Promotion rule

A phase may advance past `CODE_COMPLETE` only when gates 1–6 pass **and** the
database-dependent gates 7–11 have run against a disposable database. Test
count alone is never sufficient (Guardrail §10, §28).
