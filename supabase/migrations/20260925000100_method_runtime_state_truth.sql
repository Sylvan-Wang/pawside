-- Pawside Internal Beta P0: completion truth, explicit idempotency, and safe recovery metadata.

begin;

alter table public.workout_sessions
  add column completion_request_id uuid,
  add column completion_rule_version text;

create unique index workout_sessions_completion_request_idx
  on public.workout_sessions(user_id, completion_request_id)
  where completion_request_id is not null;

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
         session.status, session.started_at
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
      'cycle_completed', target_session.split_key = 'legs'
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

  update public.session_prescriptions
  set status = 'completed', completed_at = now()
  where id = target_session.session_prescription_id;

  update public.method_cycles
  set push_session_id = case when target_session.split_key = 'push' then p_session_id else push_session_id end,
      pull_session_id = case when target_session.split_key = 'pull' then p_session_id else pull_session_id end,
      legs_session_id = case when target_session.split_key = 'legs' then p_session_id else legs_session_id end
  where id = target_session.cycle_id;

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
    current_user_id, current_date,
    case target_session.split_key when 'push' then '推' when 'pull' then '拉' else '腿' end,
    actual_duration, p_notes, legacy_exercises, p_session_id
  ) on conflict (method_workout_session_id) do nothing;

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
    'next_prescription_id', next_prescription_id
  );
end;
$$;

create or replace function public.complete_method_session_v2(
  p_session_id uuid,
  p_completion_request_id uuid,
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
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_completion_request_id is null then
    raise exception 'Completion request id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select session.user_id, session.status, session.completion_request_id
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id
  for update;

  if target_session.user_id is null or target_session.user_id <> current_user_id then
    raise exception 'Training session not found' using errcode = 'P0002';
  end if;

  if target_session.status <> 'completed'
     and target_session.completion_request_id is not null
     and target_session.completion_request_id <> p_completion_request_id then
    raise exception 'A different completion request is already in progress' using errcode = '55000';
  end if;

  if target_session.status <> 'completed' then
    update public.workout_sessions
    set completion_request_id = p_completion_request_id
    where id = p_session_id;
  end if;

  return public.complete_method_session(p_session_id, p_duration_minutes, p_notes);
end;
$$;

revoke all on function public.complete_method_session_v2(uuid, uuid, integer, text) from public, anon;
grant execute on function public.complete_method_session_v2(uuid, uuid, integer, text) to authenticated;

comment on function public.complete_method_session_v2(uuid, uuid, integer, text) is
  'Completes one fully recorded Method session with an explicit request id; incomplete sessions remain recoverable and never advance the split.';

commit;
