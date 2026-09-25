-- Pawside runtime cutover — NOT a supabase/migrations/ file. Read supabase/cutover/README.md first.
--
-- Drops UNIQUE(workout_sessions.session_prescription_id).
--
-- PRE-CONDITIONS (verify before running, all must pass):
--   1. The deployed app build no longer resolves a session with
--      `.eq('session_prescription_id', ...).maybeSingle()`.
--      Check: grep the deployed build for `maybeSingle` on workout_sessions.
--   2. supabase/migrations/20260925000200_training_date_navigation.sql has been
--      applied (it creates workout_sessions_prescription_idx).
--   3. No prescription currently needs the invariant for correctness.
--
-- DIAGNOSTIC — prescriptions that already have more than one session. If this
-- returns rows, the released read path is ALREADY at risk and the app must be
-- deployed before this file is applied.
--
--   select session_prescription_id, count(*) as session_count
--   from public.workout_sessions
--   group by session_prescription_id
--   having count(*) > 1
--   order by session_count desc;
--
-- ROLLBACK — only possible while no prescription has more than one session:
--   alter table public.workout_sessions
--     add constraint workout_sessions_session_prescription_id_key
--     unique (session_prescription_id);

begin;

alter table public.workout_sessions
  drop constraint if exists workout_sessions_session_prescription_id_key;

-- The lookup guarantee that replaces the dropped uniqueness invariant.
create index if not exists workout_sessions_prescription_idx
  on public.workout_sessions(session_prescription_id, started_at desc);

commit;
