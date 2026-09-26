# Pawside｜Phase 0 Implementation Map Baseline
**用途：给 DSH 做 verify/update，而不是从零重审。**
**来源：上一轮 repo implementation audit + 当前两份 Patch。**
**注意：以下是 baseline，不是最终事实。DSH 必须用当前 checkout 的真实 caller `file:line` 验证；代码变化时更新。**

---

# 0. Status 规则

只能使用：

```text
IMPLEMENTED
PARTIAL
MISSING
CONFLICT
BLOCKED_PRODUCT_DECISION
```

强制：

> schema / column / route / function 存在，但没有真实 production caller = `MISSING`。

`IMPLEMENTED` 必须提供实际用户流程 caller 的 `file:line`。

---

# 1. Decision Baseline

以下不再重新讨论：

| Item | Baseline decision |
|---|---|
| Calorie target | 用户主动设置 |
| Protein target | derived，`weight_kg × 1.6` |
| Fat target | derived，`target_kcal × 25% / 9` |
| Carb target | derived from remaining energy |
| Nutrient calculation | `per_100g × actual_weight / 100` |
| Nutrition canonical write | normalized `user_food_logs` / `user_food_log_items` / `daily_nutrition_summary` |
| Legacy `food_logs` | compatibility only |
| Universal calorie floor | none |
| RMR without age | `not_assessable` |
| Recovery | subjective context only |
| Two workouts/day | independent session feedback |
| Weekly trend | deterministic Trend Engine, not LLM |
| AI unavailable | Facts/Rules/Budget/Logs still work |

---

# 2. Prefilled Implementation Map

| Requirement | Baseline Status | Prior finding | DSH verification required |
|---|---|---|---|
| Existing onboarding: goal/sex/height/weight/weekly target/calorie target | IMPLEMENTED | Existing onboarding already stores these fields | Confirm current page/API caller `file:line` |
| User manually enters macro targets | N/A / PROHIBITED | Product Patch says macros derived, not manually required | Ensure no new required manual fields are introduced |
| `daily_protein_target_g` / `daily_carb_target_g` / `daily_fat_target_g` persistence | MISSING | Prior audit found no such live fields/path | Verify current schema and actual write/read callers |
| Macro target generator | MISSING | No deterministic 1.6 / 25% / remainder engine previously | Verify no equivalent current caller |
| Structured food reference DB | IMPLEMENTED | `foods`, `food_aliases`, `food_nutrition`, `food_portion_templates` existed | Confirm current schema + production search caller |
| Four nutrient reference values | IMPLEMENTED at reference layer | DB has kcal/protein/carb/fat | Confirm search/detail API returns all four |
| Legacy food save keeps all four macros | PARTIAL / likely MISSING | Prior live path persisted only kcal + protein in JSONB | Verify current form/save caller |
| Normalized `user_food_logs` table | MISSING as application feature | Schema/RLS existed but no app caller | Mandatory no-caller check |
| Normalized `user_food_log_items` table | MISSING as application feature | Schema/RLS existed but no app caller | Mandatory no-caller check |
| `daily_nutrition_summary` | MISSING as application feature | Schema existed, totals remained unused/default | Confirm no active aggregator/upsert caller |
| Canonical normalized nutrition write path | MISSING | Prior app writes legacy `food_logs.foods JSONB` | Wire normalized path |
| Nutrition Budget target/consumed/remaining | MISSING | No shared budget service | Verify grep + caller map |
| Meal Feedback after save | MISSING | Save → invalidate DB review → toast → Home | Verify current save handler |
| Food Equivalent | MISSING / P1 | No reverse solve service | Out of this round unless direct P0 dependency |
| Condiment data | IMPLEMENTED reference / PARTIAL UX | Reference data exists; small weights suffered rounding | Verify precision path |
| Workout save trigger | IMPLEMENTED | Free workout inserts `workout_logs`; Method runtime writes canonical legacy log | Confirm caller lines |
| Workout Session Feedback | MISSING | Only completion message / next split existed | Verify current completion surface |
| Reusable workout rule primitives | PARTIAL | duration / completeness / data-quality primitives existed | Verify applicability to session scope |
| Session-level feedback persistence | MISSING | Daily review keyed by date could not represent 2 sessions/day | Verify current schema |
| Recovery Check-in storage | MISSING | No dedicated V1 storage known | Verify current repo |
| Daily Review endpoint | PARTIAL | GET/POST/PATCH existed, day-level only | Verify current API contract |
| Daily Review carb/fat/budget inputs | MISSING | Prior preprocessing used only kcal/protein | Verify current `ai-rules` / route |
| Daily Review structured sections | MISSING | Prior output flat summary/insights/actions | Verify current schema |
| Orchestrator abstraction | MISSING | Prior grep found none | Verify current repo |
| Home workout progress | IMPLEMENTED | Real workout query | Verify current caller |
| Home nutrition progress | PARTIAL | Meal count only; target/macros not rendered | Verify current UI |
| Daily Log as combined dashboard + raw text log | PARTIAL / MISSING | History/Daily Review existed but not target IA | Map current History surface |
| Weekly Log trend structure | PARTIAL | Weekly existed but not current trend contract | Verify current API/UI |
| Recovery trend | MISSING | No recovery data | Verify |
| Evidence Registry | MISSING | No versioned evidence store known | Verify |
| MetricFact contract | MISSING | No shared contract known | Verify |
| InterpretedSignal contract | MISSING | No evidence-bound interpretation contract known | Verify |
| Numeric-integrity enforcement | MISSING | Prompt instruction only; free text could invent numbers | Verify current validator |
| Feedback 👍/👎 persistence | PARTIAL | Daily-review row only; date scoped | Verify current route/UI |
| Feedback analytics/eval dataset | MISSING | No analytics / event sink known | Verify; P0 only if AI Patch requires storage now |
| Cache invalidation | CONFLICT | DB daily_review invalidation existed; client sessionStorage stale and daily_summary invalidation gap | Verify current implementation |
| Adjacent-day preload | MISSING | No verified N-1/N/N+1 preload contract | Verify |
| Authenticated E2E | UNVERIFIED | Previous audit lacked logged-in E2E | Do not claim prod-ready without it |

---

# 3. Known Legacy Conflicts to Re-check

## 3.1 `weight × 31`

Prior audit found a calorie fallback equivalent to:

```text
weight_kg × 31
```

This is **not** authority for the new Macro Target / Budget engine.

DSH must classify it:

```text
REUSED
COMPATIBILITY_ONLY
CONFLICT
SAFE_TO_REMOVE_LATER
```

If retained for legacy behavior, expose its basis distinctly.

---

## 3.2 `|| 2000`

Prior audit found hardcoded daily calorie fallback around:

```text
target = daily_calorie_target || 2000
```

This cannot silently survive into the new target/budget truth path.

Missing target in new P0:

```text
target = null
remaining = null
```

unless an explicitly documented fallback basis is returned.

---

## 3.3 Client cache

Prior audit found:

```text
sessionStorage["ai_summary_" + date]
sessionStorage["ai_review_" + date]
```

could survive after food/workout mutation while DB review was invalidated.

DSH must verify whether still true and close the user-visible stale path.

---

# 4. Fixed Real-Fixture Baseline

DSH must choose once in Phase 0 and reuse through every phase.

## 4.1 Method Fixture

Choose an actual existing Method session from the repo.

Record:

```text
method/program:
split:
session id:
planned exercises:
planned sets:
actual sets:
duration:
completion:
next split:
```

Preference:

> Use a real Pull/Push/Legs session with multiple exercises and non-trivial set prescriptions.

Do not fabricate a simplified 1-exercise fixture as the only integration test.

---

## 4.2 Nutrition Fixture

Choose one fixed local test user + date and record:

```text
food items
food_id
weights
kcal
protein
carb
fat
meal count
calorie target
derived macro targets
budget consumed
budget remaining
```

Must include:

- at least 2 meals;
- at least one small-weight condiment;
- at least one edit/delete run;
- one missing-target variant.

---

## 4.3 Daily Log Fixture

For the same fixed date record:

```text
recovery check-in
workout sessions
food logs
body data if present
daily facts
daily review state
cache state
```

---

# 5. Phase Drift Report Template

After each Phase:

| Metric | Before | After | Expected? | Authority / reason |
|---|---:|---:|---|---|
| workout session count |  |  |  |  |
| total planned sets |  |  |  |  |
| total completed sets |  |  |  |  |
| daily kcal |  |  |  |  |
| daily protein |  |  |  |  |
| daily carb |  |  |  |  |
| daily fat |  |  |  |  |
| calorie target |  |  |  |  |
| protein target |  |  |  |  |
| carb target |  |  |  |  |
| fat target |  |  |  |  |
| remaining kcal |  |  |  |  |
| Daily Log workout rows |  |  |  |  |
| Daily Log meal rows |  |  |  |  |
| review cache version |  |  |  |  |

Any unexplained change:

```text
REGRESSION
```

Stop the phase and reconcile before continuing.

---

# 6. Phase 0 Output Format

DSH should return a concise verified map, not a new essay:

```text
[Requirement]
Status:
Authority:
Current caller:
Current storage:
Gap:
Change:
Validation:
Decision:
```

`Decision` should be one of:

```text
DECISION_APPLIED
NO_DECISION_NEEDED
BLOCKED_PRODUCT_DECISION
```

Use `BLOCKED_PRODUCT_DECISION` only under Guardrail §22.
