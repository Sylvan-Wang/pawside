-- Pawside terminal Runtime Truth contract after Minimum P1 hardening.

begin;

do $$
declare
  start_definition text;
  completion_definition text;
  duration_definition text;
begin
  if to_regprocedure('public.start_method_session_v3(uuid,date,text,uuid,smallint,text)') is null then
    raise exception 'serialized start_method_session_v3 is missing';
  end if;

  select pg_get_functiondef('public.start_method_session_v3(uuid,date,text,uuid,smallint,text)'::regprocedure)
  into start_definition;
  select pg_get_functiondef('public.complete_method_session_v2(uuid,uuid,integer,text)'::regprocedure)
  into completion_definition;
  select pg_get_functiondef('public.update_method_session_duration(uuid,smallint,text)'::regprocedure)
  into duration_definition;

  if position('pg_advisory_xact_lock' in start_definition) = 0
     or position('active_session_conflict' in start_definition) = 0 then
    raise exception 'session start is not serialized or does not report an active-session conflict';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'workout_sessions'
      and indexname = 'workout_sessions_one_started_per_user_idx'
      and indexdef like 'CREATE UNIQUE INDEX%WHERE (status = ''started''::text)'
  ) then
    raise exception 'one-active-session partial unique index is missing';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.workout_sessions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (session_prescription_id)'
  ) then
    raise exception 'historical prescription uniqueness blocks supplemental actuals';
  end if;

  if position('from public.set_prescriptions set_plan' in completion_definition) = 0
     or position('set_actual.id is null or set_actual.status <> ''completed''' in completion_definition) = 0 then
    raise exception 'completion does not require every original prescribed set actual';
  end if;
  if position('At least one persisted set actual is required' in completion_definition) = 0
     or position('supplemental_actual_v1' in completion_definition) = 0
     or position('legacy_one_completed_set_v1' in completion_definition) = 0 then
    raise exception 'supplemental or legacy set-based completion semantics are missing';
  end if;
  if position('''progression_advanced'', false' in completion_definition) = 0 then
    raise exception 'completion still claims an undefined progression advance';
  end if;
  if position('completed_exercise_count = completed_exercise_count' in completion_definition) > 0 then
    raise exception 'ambiguous completion assignment was reintroduced';
  end if;

  if position('p_selected_session_minutes > target_session.selected_session_minutes' in duration_definition) = 0
     or position('Duration can only be shortened' in duration_definition) = 0 then
    raise exception 'active duration can still be lengthened';
  end if;

  if has_table_privilege('authenticated', 'public.method_enrollments', 'INSERT')
     or has_table_privilege('authenticated', 'public.method_enrollments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.method_cycles', 'INSERT')
     or has_table_privilege('authenticated', 'public.method_cycles', 'UPDATE') then
    raise exception 'Method state tables still expose direct authenticated writes';
  end if;

  if not has_function_privilege('authenticated', 'public.start_method_session_v3(uuid,date,text,uuid,smallint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.start_method_session_v3(uuid,date,text,uuid,smallint,text)', 'EXECUTE') then
    raise exception 'start_method_session_v3 grants are unsafe';
  end if;
end;
$$;

rollback;
