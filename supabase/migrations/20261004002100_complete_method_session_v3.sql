-- Method import runtime A1: complete sessions without hard-coded Program Days.
begin;

create or replace function public.complete_method_session_v3(
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
  total_exercise_count integer;
  completed_count integer;
  completed_set_count integer;
  required_exercise_count integer;
  original_exercise_count integer;
  actual_duration integer;
  set_span_minutes integer;
  next_split text;
  next_cycle_number integer;
  next_prescription_id uuid;
  new_cycle_id uuid;
  legacy_exercises jsonb;
  non_advancing boolean;
  legacy_set_gate boolean;
  completion_policy text;
  ledger_next_split text;
  cycle_finished boolean := false;
  next_gap_days integer := 0;
begin
  if not public.feature_enabled('multi_day_runtime') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_completion_request_id is null then
    raise exception 'Completion request id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select session.id, session.user_id, session.session_prescription_id,
         session.enrollment_id, session.cycle_id, session.split_key,
         session.status, session.started_at, session.execution_mode,
         session.log_date, session.completion_request_id,
         session.selected_session_minutes, session.required_exercise_count,
         session.original_exercise_count, session.completion_policy_version,
         session.completed_exercise_count
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id
    and session.deleted_at is null
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

  non_advancing := target_session.execution_mode in ('replay', 'supplemental');
  legacy_set_gate := not non_advancing
    and target_session.selected_session_minutes is null
    and target_session.required_exercise_count is null
    and target_session.completion_policy_version is null;
  completion_policy := coalesce(
    target_session.completion_policy_version,
    case
      when non_advancing then 'supplemental_actual_v1'
      when legacy_set_gate then 'legacy_one_completed_set_v1'
      else 'exercise_count_threshold_v1'
    end
  );

  ledger_next_split := public.next_program_day(target_session.cycle_id);

  if target_session.status = 'completed' then
    select enrollment.next_split_key, enrollment.current_cycle_number
    into next_split, next_cycle_number
    from public.method_enrollments enrollment
    where enrollment.id = target_session.enrollment_id;

    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'completed',
      'idempotent', true,
      'next_split_key', next_split,
      'current_cycle_number', next_cycle_number,
      'cycle_completed', ledger_next_split is null,
      'program_day_completed', not non_advancing,
      'session_sequence_advanced', false,
      'progression_advanced', false,
      'completed_exercise_count', target_session.completed_exercise_count,
      'selected_session_minutes', target_session.selected_session_minutes,
      'required_exercise_count', target_session.required_exercise_count,
      'original_exercise_count', target_session.original_exercise_count,
      'completion_policy_version', completion_policy,
      'completion_count_unit', case when completion_policy = 'exercise_count_threshold_v1' then 'exercise' else 'set' end,
      'execution_mode', target_session.execution_mode,
      'log_date', target_session.log_date
    );
  end if;

  select count(*) into total_exercise_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id;

  if total_exercise_count = 0 then
    raise exception 'At least one prescribed exercise is required' using errcode = '22023';
  end if;

  -- An exercise counts only when at least one original set prescription exists,
  -- every expected set execution exists, and every expected set is completed.
  -- Extra actual sets never substitute for a missing Method template.
  select count(*) into completed_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id
    and exists (
      select 1
      from public.set_prescriptions set_plan
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
    )
    and not exists (
      select 1
      from public.set_prescriptions set_plan
      left join public.set_executions set_actual
        on set_actual.exercise_execution_id = execution.id
       and set_actual.set_prescription_id = set_plan.id
       and set_actual.is_extra = false
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
        and (set_actual.id is null or set_actual.status <> 'completed')
    );

  select count(*) into completed_set_count
  from public.set_executions set_actual
  where set_actual.workout_session_id = p_session_id
    and set_actual.status = 'completed';

  original_exercise_count := coalesce(target_session.original_exercise_count, total_exercise_count);

  if non_advancing or legacy_set_gate then
    if completed_set_count < 1 then
      raise exception 'At least one persisted set actual is required' using errcode = '22023';
    end if;
    required_exercise_count := target_session.required_exercise_count;
  else
    required_exercise_count := coalesce(
      target_session.required_exercise_count,
      case
        when target_session.selected_session_minutes is not null then
          least(
            total_exercise_count,
            ceil(total_exercise_count * target_session.selected_session_minutes / 60.0)::integer
          )
        else total_exercise_count
      end
    );
    required_exercise_count := least(required_exercise_count, total_exercise_count);
    if completed_count < required_exercise_count then
      raise exception 'Session completion threshold not reached' using errcode = '22023';
    end if;
  end if;

  -- Patch B · B5 (D1): first completed set -> last completed set when there
  -- are at least two; a session merely left open for days no longer inherits
  -- that gap as its duration. Fewer than two sets has no span to measure, so
  -- it keeps the previous basis unchanged.
  if completed_set_count >= 2 then
    select ceil(extract(epoch from (max(set_actual.completed_at) - min(set_actual.completed_at))) / 60.0)::integer
    into set_span_minutes
    from public.set_executions set_actual
    where set_actual.workout_session_id = p_session_id
      and set_actual.status = 'completed';

    actual_duration := case
      when set_span_minutes > 150 then null
      else greatest(set_span_minutes, 1)
    end;
  else
    actual_duration := greatest(
      coalesce(p_duration_minutes, ceil(extract(epoch from (now() - target_session.started_at)) / 60.0)::integer),
      1
    );
  end if;

  update public.exercise_executions execution
  set status = 'completed'
  where execution.workout_session_id = p_session_id
    and exists (
      select 1
      from public.set_prescriptions set_plan
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
    )
    and not exists (
      select 1
      from public.set_prescriptions set_plan
      left join public.set_executions set_actual
        on set_actual.exercise_execution_id = execution.id
       and set_actual.set_prescription_id = set_plan.id
       and set_actual.is_extra = false
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
        and (set_actual.id is null or set_actual.status <> 'completed')
    );

  update public.workout_sessions
  set status = 'completed',
      completed_at = now(),
      duration_minutes = actual_duration,
      notes = p_notes,
      completion_rule_version = completion_policy,
      completion_policy_version = completion_policy,
      completed_exercise_count = completed_count
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
    coalesce(public.workout_log_type_for_split(target_session.enrollment_id, target_session.split_key), target_session.split_key),
    actual_duration, p_notes, legacy_exercises, p_session_id
  ) on conflict (method_workout_session_id) do nothing;

  if non_advancing then
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
      'program_day_completed', false,
      'session_sequence_advanced', false,
      'progression_advanced', false,
      'completed_exercise_count', completed_count,
      'required_exercise_count', target_session.required_exercise_count,
      'original_exercise_count', original_exercise_count,
      'selected_session_minutes', target_session.selected_session_minutes,
      'completion_policy_version', completion_policy,
      'completion_count_unit', 'set',
      'completed_count', completed_set_count,
      'required_count', 1,
      'execution_mode', target_session.execution_mode,
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

  next_split := public.next_program_day(target_session.cycle_id);

  if next_split is null then
    cycle_finished := true;
    select split.key into next_split
    from public.method_enrollments enrollment
    join public.method_splits split on split.method_release_id = enrollment.method_release_id
    where enrollment.id = target_session.enrollment_id and split.is_required
    order by split.order_index
    limit 1;
    if next_split is null then
      raise exception 'Method release has no required Program Day' using errcode = '22023';
    end if;
    update public.method_cycles
    set status = 'completed', completed_at = now()
    where id = target_session.cycle_id;

    update public.method_enrollments
    set current_cycle_number = current_cycle_number + 1,
        next_split_key = next_split, current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number into next_cycle_number;

    insert into public.method_cycles (enrollment_id, cycle_number, status)
    values (target_session.enrollment_id, next_cycle_number, 'in_progress')
    returning id into new_cycle_id;

    select split.min_gap_days into next_gap_days
    from public.method_enrollments enrollment
    join public.method_splits split on split.method_release_id = enrollment.method_release_id
    where enrollment.id = target_session.enrollment_id and split.key = next_split;
    next_gap_days := coalesce(next_gap_days, 0);
    next_prescription_id := public.create_session_prescription_for_cycle_v2(new_cycle_id, current_date + next_gap_days);
  else
    update public.method_enrollments
    set next_split_key = next_split, current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number into next_cycle_number;

    select split.min_gap_days into next_gap_days
    from public.method_enrollments enrollment
    join public.method_splits split on split.method_release_id = enrollment.method_release_id
    where enrollment.id = target_session.enrollment_id and split.key = next_split;
    next_gap_days := coalesce(next_gap_days, 0);
    next_prescription_id := public.create_session_prescription_for_cycle_v2(target_session.cycle_id, current_date + next_gap_days);
  end if;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'completed',
    'idempotent', false,
    'completed_split_key', target_session.split_key,
    'next_split_key', next_split,
    'current_cycle_number', next_cycle_number,
    'cycle_completed', cycle_finished,
    'program_day_completed', true,
    'session_sequence_advanced', true,
    'progression_advanced', false,
    'completed_exercise_count', completed_count,
    'required_exercise_count', required_exercise_count,
    'original_exercise_count', original_exercise_count,
    'selected_session_minutes', target_session.selected_session_minutes,
    'completion_policy_version', completion_policy,
    'completion_count_unit', case when legacy_set_gate then 'set' else 'exercise' end,
    'completed_count', case when legacy_set_gate then completed_set_count else completed_count end,
    'required_count', case when legacy_set_gate then 1 else required_exercise_count end,
    'execution_mode', target_session.execution_mode,
    'log_date', target_session.log_date,
    'next_prescription_id', next_prescription_id
  );
end;
$$;

revoke all on function public.complete_method_session_v3(uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.complete_method_session_v3(uuid, uuid, integer, text)
  to authenticated;

comment on function public.complete_method_session_v3(uuid, uuid, integer, text) is
  'Multi-day runtime completion v3. Preserves Patch B B5 set-span duration, uses release-backed labels and rotation, and schedules the next prescription from min_gap_days.';

commit;
