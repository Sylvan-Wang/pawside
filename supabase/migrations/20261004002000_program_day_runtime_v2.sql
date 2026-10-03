-- Method import runtime A2: generalized prescription generation and set facts.
begin;

create function public.create_program_day_prescription_v2(
  p_cycle_id uuid,
  p_split_key text,
  p_planned_for_date date default current_date
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
  if not public.feature_enabled('multi_day_runtime') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cycle_id::text, 0));

  select enrollment.user_id, enrollment.id, enrollment.method_release_id, split.id, release.version
  into target_user_id, target_enrollment_id, target_release_id, target_split_id, target_rule_version
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  join public.method_releases release on release.id = enrollment.method_release_id
  join public.method_splits split on split.method_release_id = release.id and split.key = p_split_key
  where cycle.id = p_cycle_id
    and cycle.status = 'in_progress'
    and enrollment.status = 'active'
    and enrollment.user_id = current_user_id
    and release.status = 'active'
    and release.runtime_gate_status = 'passed';
  if target_enrollment_id is null then
    raise exception 'Program Day is unavailable for this cycle' using errcode = '22023';
  end if;

  select prescription.id into existing_prescription_id
  from public.session_prescriptions prescription
  where prescription.enrollment_id = target_enrollment_id
    and prescription.cycle_id = p_cycle_id
    and prescription.split_key = p_split_key
    and prescription.status <> 'cancelled'
  order by prescription.generated_at desc
  limit 1;
  if existing_prescription_id is not null then return existing_prescription_id; end if;

  insert into public.session_prescriptions (
    user_id, enrollment_id, cycle_id, method_split_id, split_key,
    planned_for_date, status, generated_from_rule_version
  ) values (
    target_user_id, target_enrollment_id, p_cycle_id, target_split_id,
    p_split_key, coalesce(p_planned_for_date, current_date), 'ready', target_rule_version
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
    rest_max_seconds, quality_requirement, target_duration_seconds, target_distance_m
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
    rest_max_seconds, quality_requirement, target_duration_seconds, target_distance_m
  )
  select exercise_prescription.id, set_number.index, 'working',
    (reps.value_json->>'min')::integer, (reps.value_json->>'max')::integer,
    null, null, false, false, null, null, null, null, null, null
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

  perform public.apply_active_adjustments_to_prescription(created_prescription_id);
  return created_prescription_id;
end;
$$;
revoke all on function public.create_program_day_prescription_v2(uuid, text, date) from public, anon;
grant execute on function public.create_program_day_prescription_v2(uuid, text, date) to authenticated;

create function public.create_session_prescription_for_cycle_v2(
  p_cycle_id uuid,
  p_planned_for_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_split_key text;
begin
  if not public.feature_enabled('multi_day_runtime') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  select enrollment.next_split_key into target_split_key
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  where cycle.id = p_cycle_id
    and cycle.status = 'in_progress'
    and enrollment.status = 'active'
    and enrollment.user_id = current_user_id;
  if target_split_key is null then return null; end if;
  return public.create_program_day_prescription_v2(p_cycle_id, target_split_key, p_planned_for_date);
end;
$$;
revoke all on function public.create_session_prescription_for_cycle_v2(uuid, date) from public, anon, authenticated;

create function public.save_method_set_actual_v2(
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
  target_set_prescription_id uuid;
  target_set_id uuid;
begin
  if not public.feature_enabled('multi_day_runtime') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_set_index < 1 or p_set_index > 50
     or (p_actual_reps is not null and p_actual_reps < 0)
     or (p_actual_weight_kg is not null and p_actual_weight_kg < 0)
     or (p_actual_rir is not null and (p_actual_rir < 0 or p_actual_rir > 20))
     or (p_actual_duration_seconds is not null and p_actual_duration_seconds < 0)
     or (p_actual_distance_m is not null and p_actual_distance_m < 0)
     or (p_actual_reps is null and p_actual_duration_seconds is null and p_actual_distance_m is null) then
    raise exception 'Invalid set actual' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  select execution.exercise_prescription_id
  into target_exercise_prescription_id
  from public.exercise_executions execution
  join public.workout_sessions session on session.id = execution.workout_session_id
  where execution.id = p_exercise_execution_id
    and execution.workout_session_id = p_session_id
    and execution.user_id = current_user_id
    and session.user_id = current_user_id
    and session.status = 'started'
    and session.deleted_at is null;
  if target_exercise_prescription_id is null then
    raise exception 'Active exercise execution not found' using errcode = 'P0002';
  end if;

  select set_plan.id into target_set_prescription_id
  from public.set_prescriptions set_plan
  where set_plan.exercise_prescription_id = target_exercise_prescription_id
    and set_plan.set_index = p_set_index;

  insert into public.set_executions (
    user_id, workout_session_id, exercise_execution_id, set_prescription_id,
    set_index, actual_weight_kg, actual_reps, actual_rir,
    actual_duration_seconds, actual_distance_m, status, is_extra, completed_at
  ) values (
    current_user_id, p_session_id, p_exercise_execution_id, target_set_prescription_id,
    p_set_index, p_actual_weight_kg, p_actual_reps, p_actual_rir,
    p_actual_duration_seconds, p_actual_distance_m, 'completed', target_set_prescription_id is null, now()
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
revoke all on function public.save_method_set_actual_v2(uuid, uuid, integer, numeric, integer, numeric, integer, numeric) from public, anon;
grant execute on function public.save_method_set_actual_v2(uuid, uuid, integer, numeric, integer, numeric, integer, numeric) to authenticated;

commit;
