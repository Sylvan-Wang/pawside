begin;

do $$
begin
  if to_regprocedure('public.set_method_exercise_status(uuid,uuid,text)') is null then
    raise exception 'exercise skip/resume RPC is missing';
  end if;

  if to_regclass('public.method_actual_change_events') is null then
    raise exception 'actual change event table is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name = 'actual_revision'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name = 'downstream_status'
  ) then
    raise exception 'actual invalidation state is incomplete';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'method_actual_change_events'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'actual change event RLS is not forced';
  end if;

  if has_table_privilege('authenticated', 'public.method_actual_change_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.method_actual_change_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.method_actual_change_events', 'DELETE') then
    raise exception 'actual change events expose direct writes';
  end if;
end;
$$;

rollback;
