-- Pawside Internal Beta P0 + Minimum P1: completion truth, explicit completion
-- idempotency, and the Minimum P1 per-session time-adaptation snapshot.
--
-- STRUCTURAL GUARANTEE: this migration is strictly additive.
-- It does NOT create or replace the legacy
--   public.complete_method_session(uuid, integer, text)
-- so the released caller keeps its ef51a06 semantics. The new runtime-truth
-- behaviour lives in public.complete_method_session_v2, defined in
-- 20260925000200_training_date_navigation.sql.
--
-- It also does NOT drop UNIQUE(workout_sessions.session_prescription_id).
-- That invariant is load-bearing for the released read paths; removing it is a
-- cutover step, held separately in supabase/cutover/.

begin;

-- ---------------------------------------------------------------------------
-- Completion evidence / idempotency (runtime truth)
-- ---------------------------------------------------------------------------

alter table public.workout_sessions
  add column completion_request_id uuid,
  add column completion_rule_version text,
  add column completion_policy_version text,
  add column completed_exercise_count smallint
    check (completed_exercise_count is null or completed_exercise_count >= 0);

create unique index workout_sessions_completion_request_idx
  on public.workout_sessions(user_id, completion_request_id)
  where completion_request_id is not null;

-- ---------------------------------------------------------------------------
-- Minimum P1 (PRD §3.2): per-session duration selection snapshot.
-- These columns never rewrite Method prescription data and never rewrite the
-- long-term onboarding preferred_session_minutes.
-- ---------------------------------------------------------------------------

alter table public.workout_sessions
  add column selected_session_minutes smallint
    check (selected_session_minutes is null or selected_session_minutes in (30, 45, 60, 90)),
  add column selection_source text
    check (
      selection_source is null
      or selection_source in ('profile_default', 'user_override', 'mid_session_change')
    ),
  add column required_exercise_count smallint
    check (required_exercise_count is null or required_exercise_count >= 0),
  add column original_exercise_count smallint
    check (original_exercise_count is null or original_exercise_count >= 0);

comment on column public.workout_sessions.completion_request_id is
  'Client-supplied idempotency key for one completion intent.';

comment on column public.workout_sessions.completion_rule_version is
  'Audit mirror of completion_policy_version, kept for the history diagnostics in docs/internal-beta/runtime-history-repair-plan.md.';

comment on column public.workout_sessions.completion_policy_version is
  'Which completion rule accepted this session. Minimum P1 writes exercise_count_threshold_v1.';

comment on column public.workout_sessions.completed_exercise_count is
  'How many exercises were fully completed at the moment the Program Day completed (Minimum P1 audit).';

comment on column public.workout_sessions.selected_session_minutes is
  'Minimum P1: duration the user chose for THIS session only (30|45|60|90). Never rewrites onboarding preferred_session_minutes.';

comment on column public.workout_sessions.selection_source is
  'Minimum P1: profile_default | user_override | mid_session_change.';

comment on column public.workout_sessions.required_exercise_count is
  'Minimum P1 gate: min(original_exercise_count, ceil(original_exercise_count * selected_session_minutes / 60)), snapshotted at start.';

comment on column public.workout_sessions.original_exercise_count is
  'Minimum P1: how many exercises the Program Day prescribed. Never reduced by time adaptation.';

commit;
