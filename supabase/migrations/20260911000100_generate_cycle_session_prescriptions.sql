-- Pawside 2.0 Phase 2: generate the first executable session prescription
-- when a Method cycle is created. Structured set rows are emitted only where
-- the activated Canonical Workbook release supplies structured sets and reps.

begin;

create or replace function public.create_session_prescription_for_cycle(
  p_cycle_id uuid
)
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

  select
    enrollment.user_id,
    enrollment.id,
    enrollment.method_release_id,
    enrollment.next_split_key
  into
    target_user_id,
    target_enrollment_id,
    target_release_id,
    target_split_key
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  where cycle.id = p_cycle_id
    and cycle.status = 'in_progress'
    and enrollment.status = 'active';

  if target_enrollment_id is null then
    return null;
  end if;

  select prescription.id
  into existing_prescription_id
  from public.session_prescriptions prescription
  where prescription.enrollment_id = target_enrollment_id
    and prescription.cycle_id = p_cycle_id
    and prescription.split_key = target_split_key
    and prescription.status in ('upcoming', 'ready', 'started', 'rest_deferred')
  limit 1;

  if existing_prescription_id is not null then
    return existing_prescription_id;
  end if;

  select split.id, release.version
  into target_split_id, target_rule_version
  from public.method_splits split
  join public.method_releases release on release.id = split.method_release_id
  where split.method_release_id = target_release_id
    and split.key = target_split_key
    and release.status = 'active'
    and release.runtime_gate_status = 'passed';

  if target_split_id is null then
    raise exception 'Active Method split is unavailable for cycle %', p_cycle_id;
  end if;

  insert into public.session_prescriptions (
    user_id,
    enrollment_id,
    cycle_id,
    method_split_id,
    split_key,
    planned_for_date,
    status,
    generated_from_rule_version
  )
  values (
    target_user_id,
    target_enrollment_id,
    p_cycle_id,
    target_split_id,
    target_split_key,
    current_date,
    'ready',
    target_rule_version
  )
  returning id into created_prescription_id;

  insert into public.exercise_prescriptions (
    session_prescription_id,
    exercise_id,
    order_index,
    method_role,
    progression_stage_key,
    target_summary_zh,
    target_weight_kg,
    weight_guidance_type,
    status
  )
  select
    created_prescription_id,
    split_exercise.exercise_id,
    split_exercise.order_index,
    split_exercise.method_role,
    'calibration',
    coalesce(rule.config_json->>'summary_zh', split_exercise.method_notes),
    null,
    'calibration',
    'not_started'
  from public.method_split_exercises split_exercise
  left join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  where split_exercise.method_split_id = target_split_id
  order by split_exercise.order_index;

  insert into public.set_prescriptions (
    exercise_prescription_id,
    set_index,
    set_type,
    target_reps_min,
    target_reps_max,
    target_rpe,
    target_rir,
    failure_allowed,
    failure_required,
    target_weight_kg,
    rest_min_seconds,
    rest_max_seconds,
    quality_requirement
  )
  select
    exercise_prescription.id,
    set_number.index,
    'working',
    (reps.value_json->>'min')::integer,
    (reps.value_json->>'max')::integer,
    null,
    null,
    false,
    false,
    null,
    null,
    null,
    null
  from public.exercise_prescriptions exercise_prescription
  join public.method_split_exercises split_exercise
    on split_exercise.method_split_id = target_split_id
   and split_exercise.exercise_id = exercise_prescription.exercise_id
  join public.method_prescription_field_values sets
    on sets.method_split_exercise_id = split_exercise.id
   and sets.field_key = 'sets'
   and sets.runtime_status in ('active', 'fallback_active')
  join public.method_prescription_field_values reps
    on reps.method_split_exercise_id = split_exercise.id
   and reps.field_key = 'reps'
   and reps.runtime_status in ('active', 'fallback_active')
  cross join lateral generate_series(
    1,
    greatest((sets.value_json #>> '{}')::integer, 1)
  ) as set_number(index)
  where exercise_prescription.session_prescription_id = created_prescription_id;

  return created_prescription_id;
end;
$$;

create or replace function public.generate_cycle_session_prescription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.create_session_prescription_for_cycle(new.id);
  return new;
end;
$$;

drop trigger if exists method_cycles_generate_session_prescription
  on public.method_cycles;
create trigger method_cycles_generate_session_prescription
  after insert on public.method_cycles
  for each row execute function public.generate_cycle_session_prescription();

revoke all on function public.create_session_prescription_for_cycle(uuid)
  from public, anon, authenticated;
revoke all on function public.generate_cycle_session_prescription()
  from public, anon, authenticated;

do $backfill$
declare
  cycle_to_fill record;
begin
  for cycle_to_fill in
    select cycle.id
    from public.method_cycles cycle
    join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
    where cycle.status = 'in_progress'
      and enrollment.status = 'active'
  loop
    perform public.create_session_prescription_for_cycle(cycle_to_fill.id);
  end loop;
end;
$backfill$;

comment on function public.create_session_prescription_for_cycle(uuid) is
  'Idempotently creates the open prescription for an active Method cycle from the release-pinned split and structured Canonical Workbook fields.';

commit;
