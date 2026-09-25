-- Pawside runtime-truth contract: additive schema + the structural guarantee that
-- the legacy completion function is untouched.
--
-- Run with psql against a database that has supabase/migrations/ applied.
-- This file only reads catalogs; it rolls back.

begin;

do $$
declare
  v2_definition text;
  legacy_definition text;
begin
  -- ---------------------------------------------------------------------
  -- Completion evidence columns (runtime truth)
  -- ---------------------------------------------------------------------
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name in (
        'completion_request_id',
        'completion_rule_version',
        'completion_policy_version',
        'completed_exercise_count'
      )
  ) <> 4 then
    raise exception 'Workout completion evidence columns are incomplete';
  end if;

  -- ---------------------------------------------------------------------
  -- Minimum P1 session snapshot columns (PRD §3.2)
  -- ---------------------------------------------------------------------
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name in (
        'selected_session_minutes',
        'selection_source',
        'required_exercise_count',
        'original_exercise_count'
      )
  ) <> 4 then
    raise exception 'Minimum P1 session duration snapshot columns are incomplete';
  end if;

  -- ---------------------------------------------------------------------
  -- New functions exist
  -- ---------------------------------------------------------------------
  if to_regprocedure('public.complete_method_session_v2(uuid,uuid,integer,text)') is null then
    raise exception 'Idempotent completion function is missing';
  end if;
  if to_regprocedure('public.update_method_session_duration(uuid,smallint,text)') is null then
    raise exception 'Mid-session duration change function is missing';
  end if;
  if to_regprocedure('public.start_method_session_v2(uuid,date,text,uuid,smallint,text)') is null then
    raise exception 'Duration-aware start function is missing';
  end if;

  -- ---------------------------------------------------------------------
  -- STRUCTURAL GUARANTEE: the legacy completion gate is preserved verbatim.
  -- If this block fails, a migration silently replaced released behaviour.
  -- ---------------------------------------------------------------------
  select pg_get_functiondef('public.complete_method_session(uuid,integer,text)'::regprocedure)
  into legacy_definition;

  if position('At least one completed set is required' in legacy_definition) = 0 then
    raise exception 'Legacy completion gate was altered: it no longer requires at least one completed set';
  end if;
  if position('completed_set_count' in legacy_definition) = 0 then
    raise exception 'Legacy completion function was replaced';
  end if;
  if position('exercise_count_threshold_v1' in legacy_definition) > 0 then
    raise exception 'Legacy completion function was silently given the new completion policy';
  end if;

  -- ---------------------------------------------------------------------
  -- Minimum P1 policy lives in v2 and is self-contained
  -- ---------------------------------------------------------------------
  select pg_get_functiondef('public.complete_method_session_v2(uuid,uuid,integer,text)'::regprocedure)
  into v2_definition;

  if position('exercise_count_threshold_v1' in v2_definition) = 0 then
    raise exception 'Completion policy version is missing from complete_method_session_v2';
  end if;
  if position('completed_exercise_count' in v2_definition) = 0
     or position('required_exercise_count' in v2_definition) = 0 then
    raise exception 'Exercise-count threshold gate is missing from complete_method_session_v2';
  end if;
  if position('is_extra = false' in v2_definition) = 0 then
    raise exception 'Per-exercise full-completion rule is missing from complete_method_session_v2';
  end if;
  -- Minimum P1 §6: remaining exercises must never be forced to skipped.
  if position('set status = ''skipped''' in v2_definition) > 0 then
    raise exception 'Completion forces remaining exercises to skipped';
  end if;
  -- Self-contained: v2 must not delegate the gate back to the legacy function.
  if position('public.complete_method_session(p_session_id' in v2_definition) > 0 then
    raise exception 'complete_method_session_v2 still delegates its gate to the legacy function';
  end if;

  -- ---------------------------------------------------------------------
  -- Grants
  -- ---------------------------------------------------------------------
  if not has_function_privilege(
    'authenticated',
    'public.complete_method_session_v2(uuid,uuid,integer,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.complete_method_session_v2(uuid,uuid,integer,text)',
    'EXECUTE'
  ) then
    raise exception 'Completion function grants are unsafe';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.update_method_session_duration(uuid,smallint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.update_method_session_duration(uuid,smallint,text)',
    'EXECUTE'
  ) then
    raise exception 'Duration function grants are unsafe';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'workout_sessions'
      and indexname = 'workout_sessions_completion_request_idx'
  ) then
    raise exception 'Completion request uniqueness index is missing';
  end if;
end;
$$;

rollback;
