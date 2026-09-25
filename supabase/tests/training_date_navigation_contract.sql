begin;

do $$
declare
  start_definition text;
  completion_definition text;
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.workout_sessions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (session_prescription_id)'
  ) then
    raise exception 'Prescription execution is still incorrectly unique';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name in ('view_date', 'performed_at', 'performed_time_zone', 'log_date', 'execution_mode', 'start_request_id')
  ) <> 6 then
    raise exception 'Training date attribution columns are incomplete';
  end if;

  if to_regprocedure('public.start_method_session_v2(uuid,date,text,uuid)') is null then
    raise exception 'Date-aware start function is missing';
  end if;

  select pg_get_functiondef('public.start_method_session_v2(uuid,date,text,uuid)'::regprocedure)
  into start_definition;
  select pg_get_functiondef('public.complete_method_session(uuid,integer,text)'::regprocedure)
  into completion_definition;

  if position('(execution_time at time zone p_time_zone)::date' in lower(start_definition)) = 0
     or position('p_view_date, execution_time, p_time_zone, derived_log_date' in lower(start_definition)) = 0 then
    raise exception 'log_date is not derived from performed_at and user time zone';
  end if;

  if position('target_execution_mode := case' in lower(start_definition)) = 0
     or position("target_session.execution_mode = 'replay'" in lower(completion_definition)) = 0
     or position("'progression_advanced', false" in lower(completion_definition)) = 0 then
    raise exception 'Historical replay isolation is incomplete';
  end if;

  if not has_function_privilege('authenticated', 'public.start_method_session_v2(uuid,date,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.start_method_session_v2(uuid,date,text,uuid)', 'EXECUTE') then
    raise exception 'Date-aware start grants are unsafe';
  end if;
end;
$$;

rollback;
