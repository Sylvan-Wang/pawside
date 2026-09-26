# Pawside｜Phase 0 Implementation Map — DSH verified

**Status:** baseline verified against current checkout.
**Verification tool:** read / grep / glob only. **Shell execution was unavailable in this session**, so this map contains no test-run, build, or SQL-execution evidence. See §5.

**Method:** baseline `Pawside_Phase0_Implementation_Map_Baseline.md` was verified row by row, not re-derived.

---

# 1. Baseline verdict

| Verdict | Count |
|---|---|
| Baseline row confirmed correct | 36 |
| Baseline row **materially wrong** | 1 (`Existing onboarding`) |
| Baseline row under-specified (needs a second row) | 1 (`Nutrition canonical write`) |
| New finding not in baseline | 2 |
| **Corrections to this map after implementation began** | 1 (`weight_kg` — see §3.3) |

Baseline is **accurate on nutrition tables, budget, cache, session persistence, Home rendering, analytics, and workout save**. Corrections are in §3.

---

# 2. Confirmed baseline rows (verified, with real caller evidence)

## 2.1 Nutrition — normalized model is schema-only (`MISSING` per Guardrail §12.1)

| Requirement | Status | Real caller | Evidence |
|---|---|---|---|
| `user_food_logs` | **MISSING** | **none** | Repo-wide grep: only schema + RLS + contract test |
| `user_food_log_items` | **MISSING** | **none** | Same |
| `daily_nutrition_summary` | **MISSING** | **none** | Same; no aggregator, no upsert |
| Canonical normalized write path | **MISSING** | — | Active path writes legacy `food_logs.foods` |

Schema: `supabase/migrations/20260413000000_v3_food_schema.sql:78,95,124`.
RLS hardening: `supabase/migrations/20260906000100_pawside_backend_activation_hardening.sql:72-81`.
Contract test asserts existence only: `supabase/tests/pawside_backend_contract.sql:15-18`.

Legacy self-description confirming intent (not caller):
`supabase/migrations/20260904000100_legacy_compatibility_schema.sql:76` — *"Deprecated write model … New nutrition facts use user_food_logs and items."*

**Consequence:** Guardrail §15's canonical-source switch begins from **zero committed app code**. There is no partial wiring to extend.

## 2.2 Structured food reference (`IMPLEMENTED`, reference layer)

| Item | Status | Evidence |
|---|---|---|
| `foods`, `food_aliases`, `food_nutrition`, `food_portion_templates` | **IMPLEMENTED** | `app/api/foods/search/route.ts:18-63`; `app/api/foods/[id]/nutrition/route.ts:18-42` |
| Production caller | **IMPLEMENTED** | `app/food/FoodPageClient.tsx:93-104` (client-side Supabase search) |
| Four nutrient reference values returned | **IMPLEMENTED** | search returns kcal/protein/fat/carb `app/api/foods/search/route.ts:25-30`; detail adds `fiber_g`,`sodium_mg` `app/api/foods/[id]/nutrition/route.ts:26-33` |
| `food_portion_templates` consumption | **MISSING** | Returned by detail API `route.ts:64`, **no frontend caller** |

## 2.3 Live food save is lossy (`PARTIAL`)

`app/food/FoodPageClient.tsx:343-353` persists only:

```ts
foods: valid.map(f => ({
  name: f.name,
  weight_g: Number(f.weight),
  calories: f.calories ? Number(f.calories) : undefined,
  protein_g: f.protein ? Number(f.protein) : undefined,
}))
```

Search at `FoodPageClient.tsx:95,102` also selects only `energy_kcal, protein_g` — carb/fat are never fetched. Editor has the same loss: `app/food/[id]/edit/page.tsx:68-73`.

## 2.4 Budget / Meal Feedback / Food Equivalent

| Requirement | Status | Evidence |
|---|---|---|
| Nutrition Budget target/consumed/remaining | **MISSING** | Grep `budget\|remaining\|换算` → no service, no route, no type |
| Meal Feedback container | **MISSING** | Save → `await invalidateAIReview` → `show('保存成功')` → `setTimeout(() => router.push('/home'), 1200)` at `FoodPageClient.tsx:355-357` |
| Food Equivalent | **MISSING / P1** | No reverse-solve code |

## 2.5 Daily Review (`PARTIAL`, day-level only)

| Item | Status | Evidence |
|---|---|---|
| GET / POST / PATCH | **IMPLEMENTED** | `app/api/ai/daily-review/route.ts:25,52,168` |
| Carb/fat/budget inputs | **MISSING** | `app/food/FoodPageClient.tsx` never captures them; `lib/ai-rules.ts:192-198` aggregates `calories` + `protein_g` only |
| Structured sections (`overall`/`key_findings`/`tomorrow_guidance`/`safety`) | **MISSING** | `dailyReviewSchema` = flat `summary/insights/actions/data_quality_tip/tone` at `lib/ai-client.ts:72-93` |
| Numeric-integrity enforcement | **MISSING** | `isDailyReviewPayload` (`ai-client.ts:236-253`) validates **types only**; numbers inside strings are unconstrained |
| Cache invalidation honesty | **IMPLEMENTED** | Only successful OpenAI results cached, `route.ts:152`; rationale comment `:150-151` |
| Orchestrator abstraction | **MISSING** | Grep `orchestrat` → 0 matches |

## 2.6 Session feedback persistence is schema-blocked (`MISSING`, hard constraint)

`supabase/migrations/20260904000100_legacy_compatibility_schema.sql:151`:

```sql
unique(user_id, content_type, target_date)
```

**One review row per user per content type per day.** AC-P09 ("同日多个 workout session 可各自拥有 Result / Feedback") is therefore **not representable** without a new content type or a scope column. Confirms baseline row `Session-level feedback persistence = MISSING`.

## 2.7 Workout save triggers (`IMPLEMENTED`)

| Path | Evidence |
|---|---|
| Free workout | `app/workout/page.tsx:65-76` |
| Method session complete | `app/training/sessions/[sessionId]/page.tsx:529-533` → `app/api/training/sessions/[sessionId]/complete/route.ts:39-44` → RPC `complete_method_session_v2` |
| **Method session projects into legacy `workout_logs`** | `supabase/migrations/20260925000500_training_runtime_truth_hardening.sql:469-475` (`method_workout_session_id`, `exercises` with `rir`/`extra`) |

**Key reuse finding:** the persisted exercise shape already matches `lib/ai-rules.ts` `Exercise`. Session recap primitives are reusable without new plumbing.

## 2.8 Reusable rule primitives (`PARTIAL`, day-scoped callers only)

Defined in `lib/ai-rules.ts`: `evaluateCalories:58`, `evaluateProtein:96`, `evaluateDuration:108`, `evaluateExerciseCompleteness:119`, `preprocessDailyData:170`.

Only callers are day-level: `preprocessDailyData` at `app/api/ai/daily-review/route.ts:3,116`; the four evaluators at `lib/ai-rules.ts:181,182,200,201`. No session-scoped entry point exists.

## 2.9 Workout Result surface (`MISSING`)

Only `app/training/sessions/[sessionId]/page.tsx:832-848` — "今天的训练已记录" + next split + "查看训练计划". Grep `feedback|recap|回顾|总结` over `app/training/**` returns no recap surface.

## 2.10 Home Dashboard

| Card | Status | Evidence |
|---|---|---|
| today workout progress | **IMPLEMENTED** | `app/home/page.tsx:69`, rendered `:349-354` |
| today nutrition progress | **PARTIAL — meal count only** | `:70`, rendered `:358-360` as `已记录 N 餐`; `todayFoods` never used beyond `.length` |
| weekly completion | **IMPLEMENTED** | `:71,81`; `weekTarget = weekly_workout_target \|\| 3` at `:237` |
| streak | **IMPLEMENTED** | `:88-105` |
| daily summary | **IMPLEMENTED (degraded)** | fetched `:182-186`, rendered `:386`; falls back to rule string |
| weight trend | **IMPLEMENTED** | `:72`, rendered `:397-408` |
| calorie target/progress | **MISSING** | `daily_calorie_target` fetched `:68` / typed `:14` but **never rendered** |
| macro target/progress | **MISSING** | absent |

## 2.11 Analytics / feedback events

Grep `analytics|posthog|mixpanel|amplitude|logEvent|gtag|plausible|track(|sendBeacon` → **0 matches**.
Feedback persistence exists but date-scoped only: `ai_generated_content.feedback` (`20260904000100:147`), PATCH `app/api/ai/daily-review/route.ts:178-185`, UI `app/history/[date]/page.tsx:136-147,290-297`.

## 2.12 Cache invalidation (`CONFLICT`, confirmed)

`lib/utils.ts:7-18` deletes only `content_type='daily_review_ai'`. Confirmed gaps:

1. `sessionStorage['ai_summary_' + date]` read-and-return at `app/home/page.tsx:176-178` — **never cleared** → direct AC-P07 blocker.
2. `sessionStorage['ai_review_' + date]` at `app/history/[date]/page.tsx:73-79` — cleared only in the delete path `:128`.
3. `daily_summary` cache never invalidated.
4. `is_stale` column (`20260904000100:148`) never read or written anywhere.

## 2.13 Evidence Registry / MetricFact / InterpretedSignal

All **MISSING**. No registry, no `MetricFact`, no `InterpretedSignal` in the repo.

**Adjacent pre-existing artefact:** `docs/product/system/method/source-registry.json` (`schemaVersion: 1`) already pins external inputs with `sourceKey`, `type`, `version`, `sha256`, `status`, `limitations` — including `status: "missing"` for `SRC-METHOD-TXT`. The new Evidence Registry must follow this established pattern rather than inventing a third registry shape. Bridging the two is **`FOLLOW_UP`** (touches Method provenance, outside both Patches' P0).

## 2.14 Recovery check-in storage (`MISSING`)

No `sleep_quality_self_report` / `post_workout_recovery_self_report` anywhere — no table, column, type, or code. Grep `recovery|sleep_quality|self_report|check_in` returns only the unrelated Method `current_state='recovery_check'` enum and `recovery_decision_id uuid` at `supabase/migrations/20260904000200_method_foundation.sql:112,167`.

**Architectural seam (record, do not resolve this round):** `recovery_decision_id` is a dangling FK — its comment at `:166` says *"Phase 7 adds the FK after recovery_decisions exists"* and `recovery_decisions` **does not exist** (grep → 0 table matches). A second, unrelated recovery namespace (the Product Patch check-in) is about to be created. Per AI Patch §37, objective recovery is **P2** and Product Patch §8 forbids the check-in from adjusting training, so V1 storage is context/display only. **`FOLLOW_UP`:** decide later whether the check-in feeds Method recovery. Not a blocker because no user-visible behaviour depends on the link this round.

## 2.15 Weekly Log (`PARTIAL`)

`app/weekly/page.tsx:50-94,133,155-162` computes counts, duration, avg calories, weight — **no protein/carb/fat series**, no deterministic trend engine.

---

# 3. Baseline corrections (require Ledger update)

## 3.1 CORRECTION — `Existing onboarding` is **CONFLICT**, not `IMPLEMENTED`

Baseline row: *"Existing onboarding: goal/sex/height/weight/weekly target/calorie target — IMPLEMENTED"*.

**False for two of the six fields.** Verified write path:

- Onboarding **does** collect: `goal`, `gender`, `height_cm`, `reference_weight_kg`, `weight_unit` — submitted at `app/onboarding/page.tsx:127-130`, persisted via `supabase.rpc('complete_phase2_onboarding', …)` at `app/api/onboarding/route.ts:76-87`.
- Onboarding **does not** collect or send `daily_calorie_target` or `weekly_workout_target`. The API request contract omits them: `lib/contracts/onboarding.ts:41-44`.
- Onboarding **reads back** `weight_unit`/`onboarding_completed`/`onboarding_version` (`app/api/onboarding/route.ts:29`) and writes `reference_weight_kg` — the 2.0 field. The legacy `weight_kg` is *not* written by onboarding.

**Where the two targets are actually written:** only `app/settings/page.tsx:56-65`, and **both writes fabricate a value when the field is blank**:

```ts
weekly_workout_target: Number(form.weekly_workout_target) || 3,
daily_calorie_target: Number(form.daily_calorie_target) || 2000,
```

**Why this matters for P0:** Product Patch §4 requires the user to actively set the calorie target, and AC-P01 requires onboarding to be the place that asks for it. Neither is true today. Product §3.1 lists "每周训练目标 / 每日热量目标" as retained onboarding fields — that was **never implemented**, so §3.1 is describing an intended state, not current state.

## 3.2 NEW FINDING — `|| 2000` / `|| 3` are on a **write** path, not only a read fallback

Baseline §3.2 located `target = daily_calorie_target || 2000` on the read side. It is **also** a persistence defect: Settings writes `2000`/`3` into the profile, which destroys the `missing` state the baseline requires (`target = null; remaining = null`).

Current read-side duplicates (all must gain distinguishable basis):

| Location | Fallback |
|---|---|
| `app/settings/page.tsx:61` | `\|\| 3` → **persisted** |
| `app/settings/page.tsx:62` | `\|\| 2000` → **persisted** |
| `lib/utils.ts:49` | `profile?.daily_calorie_target \|\| 2000` |
| `lib/ai-rules.ts:54-55,69` | `estimateMaintenance = round(weight_kg * 31)` |
| `app/home/page.tsx:237` | `weekly_workout_target \|\| 3` |
| `app/weekly/page.tsx:56` | `weekly_workout_target \|\| 3` |

Guardrail §2.2 forbids these surviving silently into the new target path. Classification per §14:

- `weight × 31` (`lib/ai-rules.ts:54`) → **CONFLICT** — it is the de-facto calorie basis for users with no target, and AI Patch §12.1 provides the authoritative derivation instead.
- `|| 2000` / `|| 3` on write → **CONFLICT** — must stop persisting a fabricated target.
- `|| 2000` on read → **COMPATIBILITY_ONLY** if retained, but must expose basis (`user_target` / `estimated_legacy` / `pawside_default_legacy` / `missing`).

## 3.3 CORRECTED — body weight **is** written by onboarding; weight precedence is resolved

This section previously claimed onboarding does not write `weight_kg`. **That was wrong**, and the correction removes a blocker. `complete_phase2_onboarding` inserts `weight_kg` from `p_reference_weight_kg`:

```sql
insert into public.user_profiles (..., reference_weight_kg, weight_kg, ...)
select ..., p_reference_weight_kg, p_reference_weight_kg, ...
on conflict (id) do update set
  reference_weight_kg = excluded.reference_weight_kg,
  weight_kg = excluded.weight_kg,          -- 20260910000100:290
```

So after onboarding both `weight_kg` and `reference_weight_kg` hold the same value, and the macro generator always has a weight.

**Resolved precedence for macro derivation** (`DECISION_APPLIED`):

```text
latest body_metrics.weight_kg      -- most recent objective measurement
  → else user_profiles.weight_kg   -- synced from onboarding
  → else not_assessable
```

Implementation: `lib/nutrition/macro-targets.ts` accepts the resolved `weightKg`; the resolver itself belongs in the Metric Engine phase.

**Latent pre-existing issue (recorded, not fixed this round):** `on conflict ... weight_kg = excluded.weight_kg` means re-submitting onboarding after a body-metrics update resets current weight back to the onboarding entry. Pre-existing, `origin = pre_existing`. Does it break this Patch? **NO** — macro derivation reads the latest `body_metrics` first, so the stale profile value is not used when measurements exist. `FOLLOW_UP`.

**Still a real design constraint:** Product §4.1 makes macros **derived, not user-filled**, and AC-P02 requires them labelled "系统建议". The macro generator therefore must never be represented as a user-set limit — enforced in the onboarding UI copy and must be enforced again in the Daily Log / Meal Feedback surfaces.

## 3.4 NEW FINDING (pre-existing) — v1 onboarding RPC cannot be created on a fresh DB

The current `20260910000100_method_enrollment_foundation.sql:221-232` source
places `p_join_method boolean default true` after every non-default parameter.
The earlier `42P13` report was produced from a stale signature and is therefore
not a confirmed defect. This correction does not make the database replay-ready:
fresh migration replay and SQL contracts still have to pass before
`DB_MIGRATION_READY` can be claimed.

## 3.5 Scope reconciliation required (carried from prior review)

Guardrail §0 restricts the round to explicit P0; the phase plan is inconsistent with that:

- **Phase 6 (Weekly Log) requires the deterministic Trend Engine, which is P1** (AI Patch §37 item 12). Product §28 item 9 (Weekly Log IA) *is* P0. So Weekly Log IA is P0 but its trend engine is P1 — implementation must not fabricate a trend, per Product §23.1/§27.
- **Food Equivalent** (Product §11, §28 P1 item 1) → out of this round. Correctly excluded.
- **Feedback rating** (👍/👎) → Product §28 P1 item 3, **and** §14 forbids展示 until the backend stores `feedback_content_id`, `scope_id`, `prompt_version`, `model_version`, `input_snapshot_version`, `rating`, `timestamp`. Existing date-scoped `feedback` does **not** satisfy this. The current History thumbs are therefore **pre-existing non-compliant UI** under §14.

---

# 4. Phase 0 output (per baseline §6 format)

Legend: `DA` = DECISION_APPLIED · `ND` = NO_DECISION_NEEDED · `BP` = BLOCKED_PRODUCT_DECISION

| # | Requirement | Status | Authority | Current caller | Gap | Decision |
|---|---|---|---|---|---|---|
| 1 | Onboarding collects calorie target | **CONFLICT** | Product §3.1, §4, AC-P01 | `app/api/onboarding/route.ts:76-87` (no such param) | Field never collected; only Settings writes it, with `\|\| 2000` | **DA** |
| 2 | Onboarding collects weekly target | **CONFLICT** | Product §3.1 | same | Never collected; `\|\| 3` in Settings | **DA** |
| 3 | Manual macro targets | **PROHIBITED** | Product §4.1 | — | Must not add input fields | **DA** |
| 4 | Macro target persistence | **MISSING** | AI §10, §12.1 | none | No columns | **DA** |
| 5 | Macro generator | **IMPLEMENTED (Phase 0)** | AI §12.1 | `lib/nutrition/macro-targets.ts` | single source created; UI consumer wired | **DA** |
| 6 | Structured food reference | **IMPLEMENTED** | AI §9 | `FoodPageClient.tsx:93-104` | — | **ND** |
| 7 | All four macros in live save | **PARTIAL** | AI §9 | `FoodPageClient.tsx:343-353` | carb/fat dropped | **DA** |
| 8 | Normalized nutrition write | **MISSING** | Ledger; §12.1 | **none** | Must wire 3 tables | **DA** |
| 9 | Nutrition Budget | **MISSING** | AI §9; Product §10.1 | none | No service | **DA** |
| 10 | Meal Feedback | **MISSING** | Product §9, §10 | `FoodPageClient.tsx:355-357` | toast + navigate | **DA** |
| 11 | Workout Result | **MISSING** | Product §12, §13 | `sessions/[id]/page.tsx:832-848` | schedule line only | **DA** |
| 12 | Session feedback persistence | **MISSING** | Product §12.1, AC-P09 | none | `unique(user_id,content_type,target_date)` blocks it | **DA** |
| 13 | Recovery check-in storage | **MISSING** | Product §6, §7, AC-P05/06 | none | no table | **DA** |
| 14 | Daily Review carb/fat/budget input | **MISSING** | AI §27 | `ai-rules.ts:192-198` | kcal/protein only | **DA** |
| 15 | Daily Review structured sections | **MISSING** | AI §27.1 | `ai-client.ts:72-93` | flat schema | **DA** |
| 16 | Numeric integrity | **MISSING** | AI §31, AC-AI10 | `ai-client.ts:236-253` | type checks only | **DA** |
| 17 | Evidence Registry | **MISSING** | AI §4, §35 | none | none; follow `source-registry.json` pattern | **DA** |
| 18 | MetricFact / InterpretedSignal | **MISSING** | AI §22, §23 | none | none | **DA** |
| 19 | Home nutrition progress | **PARTIAL** | Product §26 | `home/page.tsx:70,358-360` | meal count only; target fetched, unrendered | **DA** |
| 20 | Daily Log IA | **PARTIAL** | Product §15-17 | `app/history/[date]/page.tsx` | not the §16 structure | **DA** |
| 21 | Weekly Log IA | **PARTIAL** | Product §22, §23 | `app/weekly/page.tsx:50-94` | no macro series; trend engine is P1 | **DA** |
| 22 | Adjacent-day preload | **MISSING** | Product §20, AC-P12 | none | none | **DA** |
| 23 | Evidence `?` component | **MISSING** | Product §25, AC-P14 | none | none | **DA** |
| 24 | Cache invalidation | **CONFLICT** | Product §21, AC-P07 | `lib/utils.ts:7-18` | sessionStorage + `daily_summary` not cleared | **DA** |
| 25 | Feedback 👍/👎 compliance | **PARTIAL / non-compliant** | Product §14 | `history/[date]/page.tsx:136-147` | missing scope/snapshot/model_version | **DA** (P1) |
| 26 | Analytics events | **MISSING** | AI §32 | none | 0 matches repo-wide | **DA** (P1) |
| 27 | Food Equivalent | **MISSING** | Product §11 (P1) | none | out of round | **ND** |

**Blockers: 0.** The single `BP` (macro weight-source precedence) was resolved in §3.3 by correcting a verification error, not by a product decision. Everything else is actionable.

---

# 4.1 Phase 0 change set (per Guardrail §24 reporting format)

Scope of this change set: **requirements 1, 2, 4, 5** — the Target layer. Nothing else was touched.

| Field | Value |
|---|---|
| Changed files | `lib/contracts/onboarding.ts`, `app/onboarding/page.tsx`, `app/api/onboarding/route.ts`, `app/settings/page.tsx`, `lib/nutrition/macro-targets.ts` (new) |
| Migration authored | `supabase/migrations/20260926000200_onboarding_target_layer.sql` |
| Migration applied where | **NOT APPLIED — no local DB.** No Supabase CLI, no Docker, ports 54321/54322 not listening, and `.env.local` points at a remote project. See `Phase_Verification_Matrix.md` §2 |
| Contract changes | `OnboardingInput` gains `daily_calorie_target: number \| null` and `weekly_workout_target: number \| null`; new `parseOptionalTarget` preserves `null` vs `0`; new bounds constants with provenance |
| Real fixture used | **BLOCKED** |
| Unit tests | **PASS** — `tests/nutrition/macro-targets.test.ts` (11), `tests/nutrition/onboarding-target-layer.test.ts` (10) |
| Integration tests | **BLOCKED** (needs DB) |
| Closed-loop test | **BLOCKED** (needs authenticated E2E) |
| TypeScript / ESLint / build | **PASS** — `tsc --noEmit` exit 0, `eslint .` exit 0, `npm run build` exit 0 |
| Regression check | **PASS** — 20 files/105 tests → 22 files/126 tests, zero failures |
| Known gap | Macro recommendation is displayed but **not yet persisted** (Phase 2/3); Home/Weekly still read `weekly_workout_target \|\| 3` |
| Deployment requirement | Apply the two migrations in order, then deploy app code. The v2 RPC must exist before the new app code is live, otherwise onboarding POST fails with "function not found" |

## What changed and why

**1. Onboarding now collects the Target layer** (Product §3.1, §4; AC-P01)

The form gained a new section `02 目标设置` immediately after `01 基础信息` — i.e. directly beneath the goal/body inputs, as requested — with the former capability section renumbered `03`. It asks for:

- **每日热量目标 (kcal)** — optional; blank persists as `NULL`, matching Product §27 ("展示 consumed，不展示假 target").
- **每周训练目标** — quick-pick `2/3/4/5 次` plus `暂不设置`.

**2. Macro recommendation is derived, never hand-filled** (Product §4.1; AC-P02)

`lib/nutrition/macro-targets.ts` is the single deterministic source for the three formulas. The onboarding preview consumes it; the UI does not recompute. Constants carry provenance comments (`AI Patch §12.1`, Evidence D). Rendered labelling is `你的目标` for calories vs `系统建议` for macros, with the Product §25.2 "Pawside 自定义" wording rather than a claim of national standard.

Guards implemented from AI Patch §12.2:
- `carb_g < 0` or non-finite → `status: 'needs_review'`, no forced split, and onboarding blocks submit with a calorie-target message.
- missing weight or missing calorie target → `status: 'insufficient_data'` with a machine-readable `reason`, never a guessed number.

**3. `0` and `missing` are kept distinct** (Guardrail §12)

`parseOptionalTarget` maps `undefined`/`null`/`''` → `null`; rejects non-numerics; rejects out-of-bounds. `0` is rejected rather than treated as "not set", and blank is never coerced to a default.

**4. Settings no longer fabricates targets** (baseline §3.2; Guardrail §2.2)

`app/settings/page.tsx` previously wrote `Number(x) || 3` and `Number(x) || 2000`, which destroyed the unset state. Blank now writes `NULL`; out-of-range input is rejected instead of clamped.

## Deliberate non-changes

- **No macro target columns added.** Product §4.1 makes macros derived, so they are not user-entered fields. Persisting them belongs with the normalized nutrition work (Phase 2/3), not to onboarding inputs. Adding columns now would create unused schema — the exact `MISSING`-by-no-caller condition this round is trying to eliminate.
- **`complete_phase2_onboarding` (v1) left untouched.** A new `_v2` function was added instead of altering the released signature, because Postgres overloads by full argument list and a defaulted-parameter change would risk argument ambiguity. No destructive function replacement, per Guardrail §13.
- **No lower bound on calories.** `bounds.min = 500` is a tamper guard; no "danger" floor was encoded, matching AI Patch §14 / E-NUT-SAFE-001.
- **No analytics events added** despite Product §21 cache semantics being in P0 — that is `FOLLOW_UP`, and Guardrail §23 forbids adding an analytics provider unprompted.

## Gaps this change set does NOT close (must not be read as Done)

Guardrail §28 requires `real production caller exists`, `real fixture validated`, `edge cases validated`, `closed-loop flow validated`, and `baseline drift checked`. For this change set:

- No caller has been *executed against a database*; the caller exists in code, typechecks, and is exercised at the contract level by unit tests, but it has never run end-to-end.
- The former Home/Weekly `\|\| 3`, Daily Summary `\|\| 2000`, and legacy `weight × 31` fallbacks have been removed from live and compatibility paths. `NULL` now remains `missing`; comparisons only use an explicit user target.
- Daily Log and Meal Feedback now consume canonical four-macro facts in code, but remain unverified against an authenticated disposable database fixture.

**Verdict: `CODE_COMPLETE` YES (Target-layer requirement only) · `LOCAL_VALIDATED` PARTIAL** — static and unit gates green, database gates `BLOCKED`. Not `REAL_FIXTURE_VALIDATED`, not `PRODUCTION_READY`.

---

# 5. Verification-status disclosure (Guardrail §17, §25)
| Gate | Status | Reason |
|---|---|---|
| `CODE_COMPLETE` | NO | Phase 0 only |
| `LOCAL_VALIDATED` | **BLOCKED** | shell execution unavailable in this session |
| `REAL_FIXTURE_VALIDATED` | **BLOCKED** | same |
| `AUTH_E2E_VALIDATED` | **BLOCKED** | same |
| `DB_MIGRATION_READY` | **BLOCKED** | migrations can be authored, not locally applied |

**Consequence:** Guardrail §13/§18 permit authoring migrations and require local apply for real integration verification. With shell unavailable, the authoring half is possible and the verification half is not. Any phase completed under this constraint must report `LOCAL_VALIDATED: BLOCKED` and must **not** claim Definition of Done (§28), which explicitly requires `real fixture validated`, `edge cases validated`, `closed-loop flow validated`, and `baseline drift checked`.

Awaiting: shell access for this session, or explicit acceptance of write-only mode with those gates reported `BLOCKED`.
