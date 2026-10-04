-- Four-split method · step 2: runtime functions no longer hard-code push/pull/legs.
--
-- complete_method_session_v2 is redefined from the LIVE definition (including the
-- Patch B set-span duration logic from 20260926000800). Only these things change:
--   1. the "next day" / "cycle finished" queries read the enrollment's release
--      (required splits in order) instead of VALUES ('push',1),('pull',2),('legs',3);
--   2. workout_logs.type comes from method_splits.name_zh (1.2: 推 / 拉 / 腿, identical
--      to the old CASE) instead of CASE ... ELSE '腿';
--   3. after a finished cycle the next day is the release's first required split.
-- For the existing three-split release every one of these evaluates to exactly
-- what it did before. create_program_day_prescription only loosens its key check.
--
-- Online execution requires Sylvan's go-ahead.

begin;

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
begin
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

  select candidate.split_key into ledger_next_split
  from (
    select split.key as split_key, split.order_index as ord
    from public.method_enrollments enrollment
    join public.method_splits split on split.method_release_id = enrollment.method_release_id
    where enrollment.id = target_session.enrollment_id and split.is_required
  ) as candidate
  where not exists (
    select 1 from public.session_prescriptions prescription
    where prescription.cycle_id = target_session.cycle_id
      and prescription.split_key = candidate.split_key
      and prescription.status = 'completed'
  )
  order by candidate.ord
  limit 1;

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

  select candidate.split_key into next_split
  from (
    select split.key as split_key, split.order_index as ord
    from public.method_enrollments enrollment
    join public.method_splits split on split.method_release_id = enrollment.method_release_id
    where enrollment.id = target_session.enrollment_id and split.is_required
  ) as candidate
  where not exists (
    select 1 from public.session_prescriptions prescription
    where prescription.cycle_id = target_session.cycle_id
      and prescription.split_key = candidate.split_key
      and prescription.status = 'completed'
  )
  order by candidate.ord
  limit 1;

  if next_split is null then
    cycle_finished := true;
    update public.method_cycles
    set status = 'completed', completed_at = now()
    where id = target_session.cycle_id;

    update public.method_enrollments
    set current_cycle_number = current_cycle_number + 1,
        next_split_key = coalesce(public.first_required_split_key(target_session.enrollment_id), 'push'),
        current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number, next_split_key into next_cycle_number, next_split;

    insert into public.method_cycles (enrollment_id, cycle_number, status)
    values (target_session.enrollment_id, next_cycle_number, 'in_progress')
    returning id into new_cycle_id;

    next_prescription_id := public.create_session_prescription_for_cycle(new_cycle_id);
  else
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

revoke all on function public.complete_method_session_v2(uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.complete_method_session_v2(uuid, uuid, integer, text)
  to authenticated;

comment on function public.complete_method_session_v2(uuid, uuid, integer, text) is
  'Runtime truth completion. Rotation and log type are read from the enrollment''s pinned Method release (multi-day capable). Duration is first-to-last completed set when 2+ sets exist (NULL above 150 minutes), else the started_at-based basis.';

create or replace function public.create_program_day_prescription(
  p_cycle_id uuid,
  p_split_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  target_enrollment_id uuid;
  target_release_id uuid;
  target_split_id uuid;
  target_rule_version text;
  existing_prescription_id uuid;
  created_prescription_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_split_key is null or p_split_key !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'Invalid Program Day' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cycle_id::text, 0));

  select enrollment.user_id, enrollment.id, enrollment.method_release_id
  into target_user_id, target_enrollment_id, target_release_id
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  where cycle.id = p_cycle_id
    and cycle.status = 'in_progress'
    and enrollment.status = 'active'
    and enrollment.user_id = current_user_id;
  if target_enrollment_id is null then return null; end if;

  -- Idempotent: an existing Day of this cycle is never regenerated.
  select prescription.id into existing_prescription_id
  from public.session_prescriptions prescription
  where prescription.enrollment_id = target_enrollment_id
    and prescription.cycle_id = p_cycle_id
    and prescription.split_key = p_split_key
    and prescription.status <> 'cancelled'
  order by prescription.generated_at desc
  limit 1;
  if existing_prescription_id is not null then return existing_prescription_id; end if;

  select split.id, release.version into target_split_id, target_rule_version
  from public.method_splits split
  join public.method_releases release on release.id = split.method_release_id
  where split.method_release_id = target_release_id and split.key = p_split_key
    and release.status = 'active' and release.runtime_gate_status = 'passed';
  if target_split_id is null then
    raise exception 'Active Method split is unavailable for cycle %', p_cycle_id;
  end if;

  insert into public.session_prescriptions (
    user_id, enrollment_id, cycle_id, method_split_id, split_key,
    planned_for_date, status, generated_from_rule_version
  ) values (
    target_user_id, target_enrollment_id, p_cycle_id, target_split_id,
    p_split_key, current_date, 'ready', target_rule_version
  ) returning id into created_prescription_id;

  insert into public.exercise_prescriptions (
    session_prescription_id, exercise_id, order_index, method_role,
    progression_stage_key, target_summary_zh, target_weight_kg,
    weight_guidance_type, status
  )
  select created_prescription_id, split_exercise.exercise_id, split_exercise.order_index,
    split_exercise.method_role, 'calibration',
    coalesce(rule.config_json->>'summary_zh', split_exercise.method_notes),
    null, 'calibration', 'not_started'
  from public.method_split_exercises split_exercise
  left join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  where split_exercise.method_split_id = target_split_id
  order by split_exercise.order_index;

  insert into public.set_prescriptions (
    exercise_prescription_id, set_index, set_type, target_reps_min,
    target_reps_max, target_rpe, target_rir, failure_allowed,
    failure_required, target_weight_kg, rest_min_seconds,
    rest_max_seconds, quality_requirement
  )
  select exercise_prescription.id, template.set_index, template.set_type,
    template.target_reps_min, template.target_reps_max, null, null,
    template.failure_allowed, template.failure_required, null,
    template.rest_min_seconds, template.rest_max_seconds, template.quality_requirement
  from public.exercise_prescriptions exercise_prescription
  join public.method_split_exercises split_exercise
    on split_exercise.method_split_id = target_split_id
   and split_exercise.exercise_id = exercise_prescription.exercise_id
  join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  join public.method_runtime_set_templates template on template.method_rule_id = rule.id
  where exercise_prescription.session_prescription_id = created_prescription_id;

  insert into public.set_prescriptions (
    exercise_prescription_id, set_index, set_type, target_reps_min,
    target_reps_max, target_rpe, target_rir, failure_allowed,
    failure_required, target_weight_kg, rest_min_seconds,
    rest_max_seconds, quality_requirement
  )
  select exercise_prescription.id, set_number.index, 'working',
    (reps.value_json->>'min')::integer, (reps.value_json->>'max')::integer,
    null, null, false, false, null, null, null, null
  from public.exercise_prescriptions exercise_prescription
  join public.method_split_exercises split_exercise
    on split_exercise.method_split_id = target_split_id
   and split_exercise.exercise_id = exercise_prescription.exercise_id
  join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  join public.method_prescription_field_values sets
    on sets.method_split_exercise_id = split_exercise.id
   and sets.field_key = 'sets' and sets.runtime_status in ('active', 'fallback_active')
  join public.method_prescription_field_values reps
    on reps.method_split_exercise_id = split_exercise.id
   and reps.field_key = 'reps' and reps.runtime_status in ('active', 'fallback_active')
  cross join lateral generate_series(1, greatest((sets.value_json #>> '{}')::integer, 1)) set_number(index)
  where exercise_prescription.session_prescription_id = created_prescription_id
    and not exists (
      select 1 from public.method_runtime_set_templates template
      where template.method_rule_id = rule.id
    );

  return created_prescription_id;
end;
$$;

revoke all on function public.create_program_day_prescription(uuid, text) from public, anon;
grant execute on function public.create_program_day_prescription(uuid, text) to authenticated;

commit;
