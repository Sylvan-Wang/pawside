-- Richer set recording: time-based (seconds) and distance + time sets.
-- Additive / relaxing only. Every existing row keeps record_shape = 'weight_reps'
-- and behaves as before; the old save_method_set_actual stays in place.
--
--   exercises.record_shape        weight_reps | bodyweight_reps | duration | distance_duration
--   set_executions                + actual_duration_seconds, + actual_distance_m
--                                 a completed set needs reps OR a duration
--   set_prescriptions / templates + target_duration_seconds, + target_distance_m
--   save_method_set_actual_v2     validates by the exercise's record_shape
--   prescription generators       copy the new targets from the Method templates
--   complete_method_session_v2    workout_logs sets also carry duration_seconds / distance_m
--
-- Online execution requires Sylvan's go-ahead.

begin;

alter table public.exercises
  add column record_shape text not null default 'weight_reps'
    check (record_shape in ('weight_reps', 'bodyweight_reps', 'duration', 'distance_duration'));

alter table public.set_executions
  add column actual_duration_seconds integer
    check (actual_duration_seconds is null or actual_duration_seconds between 1 and 86400),
  add column actual_distance_m numeric(9,2)
    check (actual_distance_m is null or actual_distance_m >= 0);

alter table public.set_executions add constraint set_executions_completed_v2_check
  check (
    status <> 'completed'
    or (completed_at is not null and (actual_reps is not null or actual_duration_seconds is not null))
  ) not valid;
alter table public.set_executions validate constraint set_executions_completed_v2_check;
alter table public.set_executions drop constraint set_executions_check;

alter table public.set_prescriptions
  add column target_duration_seconds integer
    check (target_duration_seconds is null or target_duration_seconds > 0),
  add column target_distance_m numeric(9,2)
    check (target_distance_m is null or target_distance_m > 0);

alter table public.method_runtime_set_templates
  add column target_duration_seconds integer
    check (target_duration_seconds is null or target_duration_seconds > 0),
  add column target_distance_m numeric(9,2)
    check (target_distance_m is null or target_distance_m > 0);

create or replace function public.save_method_set_actual_v2(
  p_session_id uuid,
  p_exercise_execution_id uuid,
  p_set_index integer,
  p_actual_weight_kg numeric,
  p_actual_reps integer,
  p_actual_rir numeric,
  p_actual_duration_seconds integer default null,
  p_actual_distance_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_exercise_prescription_id uuid;
  target_shape text;
  target_set_prescription_id uuid;
  target_set_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_set_index < 1 or p_set_index > 50
     or p_actual_reps < 0
     or p_actual_weight_kg < 0
     or p_actual_rir < 0 or p_actual_rir > 20
     or p_actual_duration_seconds < 1 or p_actual_duration_seconds > 86400
     or p_actual_distance_m < 0 or p_actual_distance_m > 1000000 then
    raise exception 'Invalid set actual' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select execution.exercise_prescription_id, exercise.record_shape
  into target_exercise_prescription_id, target_shape
  from public.exercise_executions execution
  join public.workout_sessions session on session.id = execution.workout_session_id
  join public.exercises exercise on exercise.id = execution.exercise_id
  where execution.id = p_exercise_execution_id
    and execution.workout_session_id = p_session_id
    and execution.user_id = current_user_id
    and session.user_id = current_user_id
    and session.status = 'started';

  if target_shape is null then
    raise exception 'Active exercise execution not found' using errcode = 'P0002';
  end if;

  if target_shape in ('weight_reps', 'bodyweight_reps') and p_actual_reps is null then
    raise exception 'Reps are required for this exercise' using errcode = '22023';
  end if;
  if target_shape in ('duration', 'distance_duration') and p_actual_duration_seconds is null then
    raise exception 'Duration is required for this exercise' using errcode = '22023';
  end if;

  select set_plan.id into target_set_prescription_id
  from public.set_prescriptions set_plan
  where set_plan.exercise_prescription_id = target_exercise_prescription_id
    and set_plan.set_index = p_set_index;

  insert into public.set_executions (
    user_id, workout_session_id, exercise_execution_id, set_prescription_id,
    set_index, actual_weight_kg, actual_reps, actual_rir,
    actual_duration_seconds, actual_distance_m,
    status, is_extra, completed_at
  ) values (
    current_user_id, p_session_id, p_exercise_execution_id, target_set_prescription_id,
    p_set_index, p_actual_weight_kg, p_actual_reps, p_actual_rir,
    p_actual_duration_seconds, p_actual_distance_m,
    'completed', target_set_prescription_id is null, now()
  )
  on conflict (exercise_execution_id, set_index) do update set
    actual_weight_kg = excluded.actual_weight_kg,
    actual_reps = excluded.actual_reps,
    actual_rir = excluded.actual_rir,
    actual_duration_seconds = excluded.actual_duration_seconds,
    actual_distance_m = excluded.actual_distance_m,
    status = 'completed',
    is_extra = excluded.is_extra,
    completed_at = excluded.completed_at
  returning id into target_set_id;

  update public.exercise_executions
  set status = 'in_progress'
  where id = p_exercise_execution_id and status = 'not_started';

  return jsonb_build_object('set_execution_id', target_set_id, 'status', 'completed');
end;
$$;

revoke all on function public.save_method_set_actual_v2(uuid, uuid, integer, numeric, integer, numeric, integer, numeric)
  from public, anon;
grant execute on function public.save_method_set_actual_v2(uuid, uuid, integer, numeric, integer, numeric, integer, numeric)
  to authenticated;

create or replace function public.create_session_prescription_for_cycle(p_cycle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  target_enrollment_id uuid;
  target_release_id uuid;
  target_split_key text;
  target_split_id uuid;
  target_rule_version text;
  existing_prescription_id uuid;
  created_prescription_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cycle_id::text, 0));
  select enrollment.user_id, enrollment.id, enrollment.method_release_id, enrollment.next_split_key
  into target_user_id, target_enrollment_id, target_release_id, target_split_key
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  where cycle.id = p_cycle_id and cycle.status = 'in_progress' and enrollment.status = 'active';
  if target_enrollment_id is null then return null; end if;

  select prescription.id into existing_prescription_id
  from public.session_prescriptions prescription
  where prescription.enrollment_id = target_enrollment_id and prescription.cycle_id = p_cycle_id
    and prescription.split_key = target_split_key
    and prescription.status in ('upcoming', 'ready', 'started', 'rest_deferred')
  limit 1;
  if existing_prescription_id is not null then return existing_prescription_id; end if;

  select split.id, release.version into target_split_id, target_rule_version
  from public.method_splits split
  join public.method_releases release on release.id = split.method_release_id
  where split.method_release_id = target_release_id and split.key = target_split_key
    and release.status = 'active' and release.runtime_gate_status = 'passed';
  if target_split_id is null then
    raise exception 'Active Method split is unavailable for cycle %', p_cycle_id;
  end if;

  insert into public.session_prescriptions (
    user_id, enrollment_id, cycle_id, method_split_id, split_key,
    planned_for_date, status, generated_from_rule_version
  ) values (
    target_user_id, target_enrollment_id, p_cycle_id, target_split_id,
    target_split_key, current_date, 'ready', target_rule_version
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
    rest_max_seconds, quality_requirement,
    target_duration_seconds, target_distance_m
  )
  select exercise_prescription.id, template.set_index, template.set_type,
    template.target_reps_min, template.target_reps_max, null, null,
    template.failure_allowed, template.failure_required, null,
    template.rest_min_seconds, template.rest_max_seconds, template.quality_requirement,
    template.target_duration_seconds, template.target_distance_m
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
    rest_max_seconds, quality_requirement,
    target_duration_seconds, target_distance_m
  )
  select exercise_prescription.id, template.set_index, template.set_type,
    template.target_reps_min, template.target_reps_max, null, null,
    template.failure_allowed, template.failure_required, null,
    template.rest_min_seconds, template.rest_max_seconds, template.quality_requirement,
    template.target_duration_seconds, template.target_distance_m
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
          'extra', set_actual.is_extra,
          'duration_seconds', set_actual.actual_duration_seconds,
          'distance_m', set_actual.actual_distance_m
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

revoke all on function public.create_session_prescription_for_cycle(uuid) from public, anon, authenticated;
revoke all on function public.create_program_day_prescription(uuid, text) from public, anon;
grant execute on function public.create_program_day_prescription(uuid, text) to authenticated;
revoke all on function public.complete_method_session_v2(uuid, uuid, integer, text) from public, anon;
grant execute on function public.complete_method_session_v2(uuid, uuid, integer, text) to authenticated;

commit;
