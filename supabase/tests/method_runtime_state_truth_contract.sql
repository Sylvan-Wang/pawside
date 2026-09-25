begin;

do $$
declare
  completion_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workout_sessions'
      and column_name = 'completion_request_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workout_sessions'
      and column_name = 'completion_rule_version'
  ) then
    raise exception 'Workout completion evidence columns are incomplete';
  end if;

  if to_regprocedure('public.complete_method_session_v2(uuid,uuid,integer,text)') is null then
    raise exception 'Idempotent completion function is missing';
  end if;

  select pg_get_functiondef('public.complete_method_session(uuid,integer,text)'::regprocedure)
  into completion_definition;

  if position('Every prescribed exercise requires at least one completed set' in completion_definition) = 0
     or position('incomplete_exercise_count' in completion_definition) = 0 then
    raise exception 'Full-session completion gate is missing';
  end if;

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
