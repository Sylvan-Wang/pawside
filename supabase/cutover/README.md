# Supabase cutover statements (NOT part of `supabase/migrations/`)

Files in this directory are **not** picked up by `supabase db push`, `supabase
migration list`, or `supabase db reset`. They are kept here on purpose.

## Why

`supabase/migrations/` must stay safe to apply on its own. A statement belongs
here when applying it **alone** would change the behaviour or the read contract
of the code that is already live.

## Pending cutover

### `20260926000100_drop_prescription_uniqueness.sql`

Drops `UNIQUE(workout_sessions.session_prescription_id)`.

Until it runs, the database keeps the original invariant "at most one workout
session per prescription". That invariant is **load-bearing for the released
app**: `app/api/training/today/route.ts` in the released build resolves the
active session with `.eq('session_prescription_id', ...).maybeSingle()`, which
returns an error as soon as two rows match.

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

1. Apply `supabase/migrations/` (all of it) and verify
   `supabase/tests/*.sql` contracts.
2. Deploy the app build whose read paths no longer assume one session per
   prescription (this branch).
3. Verify `app/api/training/today` returns `200` in production for a user with a
   single completed session.
4. Only then run this file, e.g.
   `psql "$SUPABASE_DB_URL" -f supabase/cutover/20260926000100_drop_prescription_uniqueness.sql`
   or paste it into the SQL editor.
5. Re-run `supabase/tests/method_workout_runtime_contract.sql` — after the
   cutover the released uniqueness assertion in that contract is expected to be
   replaced by the `workout_sessions_prescription_idx` lookup assertion. The
   contract file on this branch intentionally still asserts the **pre-cutover**
   state.

## Rollback

Re-adding the constraint requires that no prescription has more than one
session. Run the diagnostic in the file header before attempting it.
