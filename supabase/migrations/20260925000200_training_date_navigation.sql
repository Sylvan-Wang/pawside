-- Training date navigation: view date is independent from performed/log dates.

begin;

alter table public.workout_sessions
  drop constraint if exists workout_sessions_session_prescription_id_key;

alter table public.workout_sessions
  add column view_date date,
  add column performed_at timestamptz,
  add column performed_time_zone text,
  add column execution_mode text,
  add column start_request_id uuid;

update public.workout_sessions session
set view_date = coalesce(prescription.planned_for_date, session.log_date),
    performed_at = session.started_at,
    performed_time_zone = 'UTC',
    execution_mode = 'canonical'
from public.session_prescriptions prescription
where prescription.id = session.session_prescription_id;

alter table public.workout_sessions
  alter column view_date set default current_date,
  alter column view_date set not null,
  alter column performed_at set default now(),
  alter column performed_at set not null,
  alter column performed_time_zone set default 'UTC',
  alter column performed_time_zone set not null,
  alter column execution_mode set default 'canonical',
  alter column execution_mode set not null,
  add constraint workout_sessions_execution_mode_check
    check (execution_mode in ('canonical', 'replay'));

create index workout_sessions_prescription_idx
  on public.workout_sessions(session_prescription_id, started_at desc);
create index workout_sessions_user_view_date_idx
  on public.workout_sessions(user_id, view_date, started_at desc);
create unique index workout_sessions_start_request_idx
  on public.workout_sessions(user_id, start_request_id)
  where start_request_id is not null;

create or replace function public.start_method_session_v2(
  p_prescription_id uuid,
  p_view_date date,
  p_time_zone text,
  p_start_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_prescription record;
  existing_session record;
  created_session_id uuid;
  execution_time timestamptz := clock_timestamp();
  derived_log_date date;
  target_execution_mode text;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_view_date is null or p_time_zone is null or length(p_time_zone) > 100 or p_start_request_id is null then
    raise exception 'View date, time zone and start request id are required' using errcode = '22023';
  end if;

  begin
    derived_log_date := (execution_time at time zone p_time_zone)::date;
  exception when invalid_parameter_value then
    raise exception 'Invalid time zone' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_prescription_id::text, 0));

  select session.id, session.status, session.execution_mode, session.log_date
  into existing_session
  from public.workout_sessions session
  where session.user_id = current_user_id
    and session.start_request_id = p_start_request_id;
  if existing_session.id is not null then
    return jsonb_build_object(
      'session_id', existing_session.id,
      'status', existing_session.status,
      'execution_mode', existing_session.execution_mode,
      'log_date', existing_session.log_date,
      'idempotent', true
    );
  end if;

  select prescription.user_id, prescription.enrollment_id, prescription.cycle_id,
         prescription.split_key, prescription.status
  into target_prescription
  from public.session_prescriptions prescription
  where prescription.id = p_prescription_id
  for update;

  if target_prescription.user_id is null or target_prescription.user_id <> current_user_id then
    raise exception 'Training prescription not found' using errcode = 'P0002';
  end if;
  if target_prescription.status = 'cancelled' then
    raise exception 'Cancelled training prescription cannot be executed' using errcode = '55000';
  end if;

  select session.id, session.status, session.execution_mode, session.log_date
  into existing_session
  from public.workout_sessions session
  where session.user_id = current_user_id
    and session.session_prescription_id = p_prescription_id
    and session.view_date = p_view_date
    and session.status = 'started'
  order by session.started_at desc
  limit 1;
  if existing_session.id is not null then
    return jsonb_build_object(
      'session_id', existing_session.id,
      'status', existing_session.status,
      'execution_mode', existing_session.execution_mode,
      'log_date', existing_session.log_date,
      'idempotent', true
    );
  end if;

  target_execution_mode := case when target_prescription.status in ('ready', 'upcoming', 'rest_deferred')
    and exists (
      select 1 from public.method_enrollments enrollment
      join public.method_cycles cycle
        on cycle.id = target_prescription.cycle_id
       and cycle.enrollment_id = enrollment.id
      where enrollment.id = target_prescription.enrollment_id
        and enrollment.user_id = current_user_id
        and enrollment.status = 'active'
        and enrollment.next_split_key = target_prescription.split_key
        and enrollment.current_cycle_number = cycle.cycle_number
        and cycle.status = 'in_progress'
    )
    and not exists (
      select 1 from public.workout_sessions session
      where session.session_prescription_id = p_prescription_id
        and session.execution_mode = 'canonical'
    )
    then 'canonical' else 'replay' end;

  insert into public.workout_sessions (
    user_id, session_prescription_id, enrollment_id, cycle_id, split_key,
    status, view_date, performed_at, performed_time_zone, log_date,
    execution_mode, start_request_id
  ) values (
    current_user_id, p_prescription_id, target_prescription.enrollment_id,
    target_prescription.cycle_id, target_prescription.split_key,
    'started', p_view_date, execution_time, p_time_zone, derived_log_date,
    target_execution_mode, p_start_request_id
  ) returning id into created_session_id;

  insert into public.exercise_executions (
    user_id, workout_session_id, exercise_prescription_id, exercise_id, order_index
  )
  select current_user_id, created_session_id, prescription.id,
         prescription.exercise_id, prescription.order_index
  from public.exercise_prescriptions prescription
  where prescription.session_prescription_id = p_prescription_id
  order by prescription.order_index;

  insert into public.set_executions (
    user_id, workout_session_id, exercise_execution_id, set_prescription_id,
    set_index, status, is_extra
  )
  select current_user_id, created_session_id, execution.id, set_plan.id,
         set_plan.set_index, 'planned', false
  from public.exercise_executions execution
  join public.set_prescriptions set_plan
    on set_plan.exercise_prescription_id = execution.exercise_prescription_id
  where execution.workout_session_id = created_session_id;

  if target_execution_mode = 'canonical' then
    update public.session_prescriptions
    set status = 'started', started_at = coalesce(started_at, execution_time)
    where id = p_prescription_id;

    update public.method_enrollments
    set current_state = 'session_in_progress'
    where id = target_prescription.enrollment_id;
  end if;

  return jsonb_build_object(
    'session_id', created_session_id,
    'status', 'started',
    'execution_mode', target_execution_mode,
    'view_date', p_view_date,
    'performed_at', execution_time,
    'log_date', derived_log_date,
    'idempotent', false
  );
end;
$$;

create or replace function public.complete_method_session(
  p_session_id uuid,
  p_duration_minutes integer default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_session record;
  total_exercise_count integer;
  incomplete_exercise_count integer;
  actual_duration integer;
  next_split text;
  next_cycle_number integer;
  next_prescription_id uuid;
  new_cycle_id uuid;
  legacy_exercises jsonb;
  did_complete_cycle boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select session.id, session.user_id, session.session_prescription_id,
         session.enrollment_id, session.cycle_id, session.split_key,
         session.status, session.started_at, session.execution_mode, session.log_date
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id
  for update;

  if target_session.user_id is null or target_session.user_id <> current_user_id then
    raise exception 'Training session not found' using errcode = 'P0002';
  end if;

  if target_session.status = 'completed' then
    select enrollment.next_split_key, enrollment.current_cycle_number
    into next_split, next_cycle_number
    from public.method_enrollments enrollment
    where enrollment.id = target_session.enrollment_id;
    return jsonb_build_object(
      'session_id', p_session_id, 'status', 'completed', 'idempotent', true,
      'next_split_key', next_split, 'current_cycle_number', next_cycle_number,
      'cycle_completed', target_session.execution_mode = 'canonical' and target_session.split_key = 'legs',
      'progression_advanced', target_session.execution_mode = 'canonical',
      'log_date', target_session.log_date
    );
  end if;

  select count(*), count(*) filter (
    where execution.status = 'skipped'
       or not exists (
         select 1 from public.set_executions set_actual
         where set_actual.exercise_execution_id = execution.id
           and set_actual.status = 'completed'
       )
  )
  into total_exercise_count, incomplete_exercise_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id;

  if total_exercise_count = 0 then
    raise exception 'At least one prescribed exercise is required' using errcode = '22023';
  end if;
  if incomplete_exercise_count > 0 then
    raise exception 'Every prescribed exercise requires at least one completed set' using errcode = '22023';
  end if;

  actual_duration := greatest(
    coalesce(p_duration_minutes, ceil(extract(epoch from (now() - target_session.started_at)) / 60.0)::integer),
    1
  );

  update public.exercise_executions execution
  set status = 'completed'
  where execution.workout_session_id = p_session_id;

  update public.workout_sessions
  set status = 'completed', completed_at = now(), duration_minutes = actual_duration,
      notes = p_notes, completion_rule_version = 'all_exercises_v1'
  where id = p_session_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', exercise.canonical_name_zh,
      'status', execution.status,
      'sets', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'set', set_actual.set_index,
          'weight_kg', set_actual.actual_weight_kg,
          'reps', set_actual.actual_reps,
          'rir', set_actual.actual_rir,
          'extra', set_actual.is_extra
        ) order by set_actual.set_index), '[]'::jsonb)
        from public.set_executions set_actual
        where set_actual.exercise_execution_id = execution.id
          and set_actual.status = 'completed'
      )
    ) order by execution.order_index
  ), '[]'::jsonb)
  into legacy_exercises
  from public.exercise_executions execution
  join public.exercises exercise on exercise.id = execution.exercise_id
  where execution.workout_session_id = p_session_id;

  insert into public.workout_logs (
    user_id, date, type, duration_minutes, notes, exercises, method_workout_session_id
  ) values (
    current_user_id, target_session.log_date,
    case target_session.split_key when 'push' then '推' when 'pull' then '拉' else '腿' end,
    actual_duration, p_notes, legacy_exercises, p_session_id
  ) on conflict (method_workout_session_id) do nothing;

  if target_session.execution_mode = 'replay' then
    select enrollment.next_split_key, enrollment.current_cycle_number
    into next_split, next_cycle_number
    from public.method_enrollments enrollment
    where enrollment.id = target_session.enrollment_id;
    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'completed',
      'idempotent', false,
      'completed_split_key', target_session.split_key,
      'next_split_key', next_split,
      'current_cycle_number', next_cycle_number,
      'cycle_completed', false,
      'progression_advanced', false,
      'log_date', target_session.log_date,
      'next_prescription_id', null
    );
  end if;

  update public.session_prescriptions
  set status = 'completed', completed_at = now()
  where id = target_session.session_prescription_id;

  update public.method_cycles
  set push_session_id = case when target_session.split_key = 'push' then p_session_id else push_session_id end,
      pull_session_id = case when target_session.split_key = 'pull' then p_session_id else pull_session_id end,
      legs_session_id = case when target_session.split_key = 'legs' then p_session_id else legs_session_id end
  where id = target_session.cycle_id;

  if target_session.split_key = 'legs' then
    update public.method_cycles
    set status = 'completed', completed_at = now()
    where id = target_session.cycle_id;

    update public.method_enrollments
    set current_cycle_number = current_cycle_number + 1,
        next_split_key = 'push', current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number into next_cycle_number;

    insert into public.method_cycles (enrollment_id, cycle_number, status)
    values (target_session.enrollment_id, next_cycle_number, 'in_progress')
    returning id into new_cycle_id;

    select prescription.id into next_prescription_id
    from public.session_prescriptions prescription
    where prescription.cycle_id = new_cycle_id
      and prescription.split_key = 'push'
      and prescription.status in ('ready', 'upcoming', 'rest_deferred')
    limit 1;
    next_split := 'push';
    did_complete_cycle := true;
  else
    next_split := case target_session.split_key when 'push' then 'pull' else 'legs' end;
    update public.method_enrollments
    set next_split_key = next_split, current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number into next_cycle_number;

    next_prescription_id := public.create_session_prescription_for_cycle(target_session.cycle_id);
  end if;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'completed',
    'idempotent', false,
    'completed_split_key', target_session.split_key,
    'next_split_key', next_split,
    'current_cycle_number', next_cycle_number,
    'cycle_completed', did_complete_cycle,
    'progression_advanced', true,
    'log_date', target_session.log_date,
    'next_prescription_id', next_prescription_id
  );
end;
$$;

revoke all on function public.start_method_session_v2(uuid, date, text, uuid) from public, anon;
grant execute on function public.start_method_session_v2(uuid, date, text, uuid) to authenticated;

comment on column public.workout_sessions.view_date is
  'Date whose prescription was displayed. It never determines workout history attribution.';
comment on column public.workout_sessions.performed_at is
  'Authoritative instant at which this execution began.';
comment on column public.workout_sessions.log_date is
  'History/statistics date derived from performed_at in performed_time_zone.';
comment on column public.workout_sessions.execution_mode is
  'canonical advances Method state; replay records historical-plan execution without changing the original prescription or sequence.';

commit;
