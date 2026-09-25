# Supabase cutover statements (NOT part of `supabase/migrations/`)

Files in this directory are **not** picked up by `supabase db push`, `supabase
migration list`, or `supabase db reset`. They are kept here on purpose.

## Why

`supabase/migrations/` must stay safe to apply on its own. A statement belongs
here when applying it **alone** would change the behaviour or the read contract
of the code that is already live.

## Applied cutover

### `20260926000100_drop_prescription_uniqueness.sql`

**Status: APPLIED** to `sbwevlhzqujrtucppacl` (pawside) on 2026-09-25, together
with the app change that stops assuming one session per prescription
(master `7f854cd`).

It was applied **before** the new build went live, deliberately. The released
`start_method_session` returns early whenever any session already exists for the
prescription, so it cannot create a second one; dropping the constraint while the
old build was still serving therefore kept the multi-session count at 0, and the
new build came up with the constraint already gone. That removed the window in
which re-executing a completed Program Day would have failed against the still
present constraint.

Verified immediately before and after: `select session_prescription_id, count(*)
from public.workout_sessions group by 1 having count(*) > 1` returned 0 rows.

Drops `UNIQUE(workout_sessions.session_prescription_id)`.

Before it ran, the database kept the original invariant "at most one workout
session per prescription". That invariant was **load-bearing for the released
app**: `app/api/training/today/route.ts` in the released build resolved the active
session with `.eq('session_prescription_id', ...).maybeSingle()`, which returns an
error as soon as two rows match.

The new runtime deliberately allows more than one session per prescription:

* one canonical execution per Program Day, plus
* `supplemental` executions when the user comes back to an already completed
  Program Day, plus
* historical `replay` rows.

`supabase/migrations/20260925000200_training_date_navigation.sql` creates the
`workout_sessions_prescription_idx` lookup index that replaces the uniqueness
guarantee for lookup purposes, and the app code on this branch no longer assumes
a single row. The constraint itself is dropped only here.

## Execution order (do not reorder)

1. Apply `supabase/migrations/` (all of it) and verify `supabase/tests/*.sql`
   contracts.
2. Verify `select session_prescription_id, count(*) from public.workout_sessions
   group by 1 having count(*) > 1` returns no rows.
3. Run this file, e.g.
   `supabase db query --linked --file supabase/cutover/20260926000100_drop_prescription_uniqueness.sql`
   or `psql "$SUPABASE_DB_URL" -f ...`.
4. Deploy the app build whose read paths no longer assume one session per
   prescription.
5. Verify `app/api/training/today` returns `200` for a user with a single
   completed session.

This is exactly the order that was executed for `sbwevlhzqujrtucppacl` on
2026-09-25.

After the cutover, `supabase/tests/method_workout_runtime_contract.sql` and
`supabase/tests/training_date_navigation_contract.sql` assert the **post-cutover**
state (lookup index present, uniqueness constraint absent). A fresh environment
built from `supabase/migrations/` alone will therefore fail those two contracts
until this file is applied — that is intentional, and it is what keeps the cutover
visible instead of silently assumed.

## Rollback

Re-adding the constraint requires that no prescription has more than one
session. Run the diagnostic in the file header before attempting it.
