begin;

do $$
declare
  required_table text;
begin
  foreach required_table in array array['workout_sessions', 'exercise_executions', 'set_executions']
  loop
    if to_regclass(format('public.%I', required_table)) is null then
      raise exception 'missing Method runtime table: %', required_table;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_logs'
      and column_name = 'method_workout_session_id'
  ) then
    raise exception 'legacy workout history link is missing';
  end if;

  if to_regprocedure('public.start_method_session(uuid)') is null
     or to_regprocedure('public.save_method_set_actual(uuid,uuid,integer,numeric,integer,numeric)') is null
     or to_regprocedure('public.complete_method_session(uuid,integer,text)') is null then
    raise exception 'Method runtime functions are incomplete';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workout_sessions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%session_prescription_id%'
  ) then
    raise exception 'one actual per prescription invariant is missing';
  end if;

  if exists (
    select 1
    from (values ('workout_sessions'), ('exercise_executions'), ('set_executions')) as expected(name)
    where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = expected.name
        and c.relrowsecurity and c.relforcerowsecurity
    )
  ) then
    raise exception 'Method runtime RLS is not forced on every actual table';
  end if;

  if has_table_privilege('authenticated', 'public.workout_sessions', 'INSERT')
     or has_table_privilege('authenticated', 'public.exercise_executions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.set_executions', 'DELETE') then
    raise exception 'normalized Method actual tables expose direct writes';
  end if;
end;
$$;

rollback;
