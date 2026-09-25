-- Pawside training date navigation contract (pre-cutover state).
--
-- This asserts the state of the schema AFTER supabase/migrations/ and BEFORE
-- supabase/cutover/20260926000100_drop_prescription_uniqueness.sql.
-- Read supabase/cutover/README.md for the cutover sequence.

begin;

do $$
declare
  start_definition text;
  completion_definition text;
  duration_definition text;
begin
  -- ---------------------------------------------------------------------
  -- Program Day is independent from the calendar date.
  -- ---------------------------------------------------------------------
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name in (
        'view_date', 'performed_at', 'performed_time_zone',
        'log_date', 'execution_mode', 'start_request_id'
      )
  ) <> 6 then
    raise exception 'Training date attribution columns are incomplete';
  end if;

  select pg_get_functiondef('public.start_method_session_v2(uuid,date,text,uuid,smallint,text)'::regprocedure)
  into start_definition;
  select pg_get_functiondef('public.complete_method_session_v2(uuid,uuid,integer,text)'::regprocedure)
  into completion_definition;
  select pg_get_functiondef('public.update_method_session_duration(uuid,smallint,text)'::regprocedure)
  into duration_definition;

  if position('(execution_time at time zone p_time_zone)::date' in lower(start_definition)) = 0 then
    raise exception 'log_date is not derived from performed_at and the user time zone';
  end if;

  -- Minimum P1 §11: completion of a Program Day, not the calendar date, decides
  -- whether an execution is canonical.
  if position('supplemental' in lower(start_definition)) = 0 then
    raise exception 'execution_mode no longer distinguishes an already completed Program Day';
  end if;
  if position('view_date <> ' in lower(completion_definition)) > 0 then
    raise exception 'Completion still decides canonical/replay from the calendar date';
  end if;

  -- Minimum P1 §11.2 / §12: supplemental and replay executions never advance.
  if position('''replay'', ''supplemental''' in lower(completion_definition)) = 0
     and position('in (''replay'', ''supplemental'')' in lower(completion_definition)) = 0 then
    raise exception 'Non-advancing execution modes are not isolated in completion';
  end if;
  if position('''session_sequence_advanced'', false' in lower(completion_definition)) = 0 then
    raise exception 'Non-advancing completion response is incomplete';
  end if;

  -- Minimum P1 §10: the cycle ledger is recomputed instead of using a mechanical
  -- successor.
  if position('candidate.split_key' in lower(completion_definition)) = 0 then
    raise exception 'next_split_key is not recomputed from the cycle ledger';
  end if;

  -- Minimum P1 §7: only an active session may change duration.
  if position('''55000''' in duration_definition) = 0 then
    raise exception 'Duration change does not reject a non-active session';
  end if;

  -- ---------------------------------------------------------------------
  -- Pre-cutover invariant: the uniqueness constraint is still present.
  -- ---------------------------------------------------------------------
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workout_sessions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (session_prescription_id)'
  ) then
    raise exception 'session_prescription_id uniqueness was dropped before the app cutover; run supabase/cutover only after the app that tolerates multiple sessions is deployed';
  end if;

  -- The lookup index that replaces it for query purposes must already exist.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'workout_sessions'
      and indexname = 'workout_sessions_prescription_idx'
  ) then
    raise exception 'prescription execution lookup index is missing';
  end if;

  -- ---------------------------------------------------------------------
  -- Grants
  -- ---------------------------------------------------------------------
  if not has_function_privilege('authenticated', 'public.start_method_session_v2(uuid,date,text,uuid,smallint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.start_method_session_v2(uuid,date,text,uuid,smallint,text)', 'EXECUTE') then
    raise exception 'Date-aware start grants are unsafe';
  end if;
end;
$$;

rollback;
