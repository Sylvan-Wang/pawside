-- Method import runtime A6: apply, revoke, and skip user-owned method adjustments.
begin;

create function public.apply_active_adjustments_to_prescription(p_prescription_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  adjustment record;
  exercise_plan_id uuid;
  desired_count integer;
  existing_count integer;
begin
  select p.id, p.user_id, p.enrollment_id, p.split_key, p.status
  into target
  from public.session_prescriptions p
  where p.id = p_prescription_id;
  if target.id is null or target.status not in ('upcoming', 'ready') then return; end if;

  for adjustment in
    select a.* from public.user_method_adjustments a
    where a.user_id = target.user_id
      and a.enrollment_id = target.enrollment_id
      and a.split_key = target.split_key
      and a.revoked_at is null
    order by a.created_at
  loop
    select ep.id into exercise_plan_id
    from public.exercise_prescriptions ep
    where ep.session_prescription_id = target.id and ep.exercise_id = adjustment.exercise_id
    limit 1;
    if adjustment.action <> 'skip_day' and exercise_plan_id is null then continue; end if;

    if adjustment.action = 'hide_exercise' then
      delete from public.exercise_prescriptions where id = exercise_plan_id;
    elsif adjustment.action = 'swap_exercise' then
      update public.exercise_prescriptions
      set exercise_id = (adjustment.payload->>'exercise_id')::uuid
      where id = exercise_plan_id
        and exists (
          select 1 from public.exercise_substitutions s
          where s.exercise_id = adjustment.exercise_id
            and s.substitute_exercise_id = (adjustment.payload->>'exercise_id')::uuid
            and s.review_status = 'reviewed'
        );
    elsif adjustment.action = 'rep_range' then
      update public.set_prescriptions
      set target_reps_min = (adjustment.payload->>'min')::integer,
          target_reps_max = (adjustment.payload->>'max')::integer
      where exercise_prescription_id = exercise_plan_id
        and (adjustment.payload->>'min')::integer between 1 and 100
        and (adjustment.payload->>'max')::integer between (adjustment.payload->>'min')::integer and 100;
    elsif adjustment.action = 'set_count' then
      desired_count := (adjustment.payload->>'count')::integer;
      if desired_count between 1 and 40 then
        delete from public.set_prescriptions
        where exercise_prescription_id = exercise_plan_id and set_index > desired_count;
        select count(*) into existing_count from public.set_prescriptions where exercise_prescription_id = exercise_plan_id;
        if existing_count < desired_count and existing_count > 0 then
          insert into public.set_prescriptions (
            exercise_prescription_id, set_index, set_type, target_reps_min, target_reps_max,
            target_rpe, target_rir, failure_allowed, failure_required, target_weight_kg,
            rest_min_seconds, rest_max_seconds, quality_requirement,
            target_duration_seconds, target_distance_m
          )
          select exercise_plan_id, generated.index, last_set.set_type,
            last_set.target_reps_min, last_set.target_reps_max, last_set.target_rpe,
            last_set.target_rir, last_set.failure_allowed, last_set.failure_required,
            last_set.target_weight_kg, last_set.rest_min_seconds, last_set.rest_max_seconds,
            last_set.quality_requirement, last_set.target_duration_seconds, last_set.target_distance_m
          from generate_series(existing_count + 1, desired_count) generated(index)
          cross join lateral (
            select * from public.set_prescriptions source
            where source.exercise_prescription_id = exercise_plan_id
            order by source.set_index desc limit 1
          ) last_set;
        end if;
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.apply_active_adjustments_to_prescription(uuid) from public, anon, authenticated;

create function public.apply_adjustment_v1(
  p_enrollment_id uuid,
  p_split_key text,
  p_exercise_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_scope text default 'future'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  adjustment_id uuid;
  prescription record;
  active_session_id uuid;
  active_execution_id uuid;
  active_exercise_prescription_id uuid;
begin
  if not public.feature_enabled('adjustments') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  if current_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_action not in ('hide_exercise', 'swap_exercise', 'set_count', 'rep_range')
     or p_scope not in ('future', 'once') or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid adjustment' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.method_enrollments e
    join public.method_splits s on s.method_release_id = e.method_release_id and s.key = p_split_key
    where e.id = p_enrollment_id and e.user_id = current_user_id
  ) then raise exception 'Enrollment not found' using errcode = 'P0002'; end if;
  if p_action = 'swap_exercise' and not exists (
    select 1 from public.exercise_substitutions s
    where s.exercise_id = p_exercise_id
      and s.substitute_exercise_id = (p_payload->>'exercise_id')::uuid
      and s.review_status = 'reviewed'
  ) then raise exception 'Substitution is not approved' using errcode = '22023'; end if;

  if p_scope = 'future' then
    insert into public.user_method_adjustments (user_id, enrollment_id, split_key, exercise_id, action, payload)
    values (current_user_id, p_enrollment_id, p_split_key, p_exercise_id, p_action, p_payload)
    returning id into adjustment_id;
  else
    adjustment_id := gen_random_uuid();
  end if;

  if p_scope = 'once' then
    select ws.id, ee.id, ee.exercise_prescription_id
    into active_session_id, active_execution_id, active_exercise_prescription_id
    from public.workout_sessions ws
    join public.exercise_executions ee on ee.workout_session_id = ws.id
    where ws.user_id = current_user_id
      and ws.enrollment_id = p_enrollment_id
      and ws.split_key = p_split_key
      and ws.status = 'started'
      and ws.deleted_at is null
      and ee.exercise_id = p_exercise_id
      and ee.status <> 'completed'
    order by ws.started_at desc
    limit 1;

    if active_execution_id is not null then
      if p_action = 'hide_exercise' then
        update public.exercise_executions set status = 'skipped'
        where id = active_execution_id
          and not exists (
            select 1 from public.set_executions se
            where se.exercise_execution_id = active_execution_id and se.status = 'completed'
          );
      elsif p_action = 'swap_exercise' then
        update public.exercise_executions
        set exercise_id = (p_payload->>'exercise_id')::uuid
        where id = active_execution_id
          and not exists (
            select 1 from public.set_executions se
            where se.exercise_execution_id = active_execution_id and se.status = 'completed'
          );
      elsif p_action = 'set_count' and (p_payload->>'count')::integer between 1 and 40 then
        delete from public.set_executions
        where exercise_execution_id = active_execution_id
          and status <> 'completed'
          and set_index > (p_payload->>'count')::integer;
      elsif p_action = 'rep_range'
        and (p_payload->>'min')::integer between 1 and 100
        and (p_payload->>'max')::integer between (p_payload->>'min')::integer and 100 then
        update public.set_prescriptions
        set target_reps_min = (p_payload->>'min')::integer,
            target_reps_max = (p_payload->>'max')::integer
        where exercise_prescription_id = active_exercise_prescription_id;
      end if;
      return adjustment_id;
    end if;
  end if;

  for prescription in
    select p.id from public.session_prescriptions p
    where p.user_id = current_user_id and p.enrollment_id = p_enrollment_id
      and p.split_key = p_split_key and p.status in ('upcoming', 'ready')
  loop
    if p_scope = 'once' then
      insert into public.user_method_adjustments (id, user_id, enrollment_id, split_key, exercise_id, action, payload)
      values (adjustment_id, current_user_id, p_enrollment_id, p_split_key, p_exercise_id, p_action, p_payload);
      perform public.apply_active_adjustments_to_prescription(prescription.id);
      delete from public.user_method_adjustments where id = adjustment_id;
    else
      perform public.apply_active_adjustments_to_prescription(prescription.id);
    end if;
  end loop;
  return adjustment_id;
end;
$$;
revoke all on function public.apply_adjustment_v1(uuid, text, uuid, text, jsonb, text) from public, anon;
grant execute on function public.apply_adjustment_v1(uuid, text, uuid, text, jsonb, text) to authenticated;

create function public.revoke_adjustment_v1(p_adjustment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.feature_enabled('adjustments') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  update public.user_method_adjustments
  set revoked_at = coalesce(revoked_at, now())
  where id = p_adjustment_id and user_id = auth.uid();
  return found;
end;
$$;
revoke all on function public.revoke_adjustment_v1(uuid) from public, anon;
grant execute on function public.revoke_adjustment_v1(uuid) to authenticated;

create function public.skip_program_day_v1(p_prescription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  next_split text;
begin
  if not public.feature_enabled('adjustments') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  select p.* into target from public.session_prescriptions p
  where p.id = p_prescription_id and p.user_id = auth.uid() and p.status in ('upcoming', 'ready')
  for update;
  if target.id is null then raise exception 'Program Day not found' using errcode = 'P0002'; end if;
  update public.session_prescriptions set status = 'skipped', completed_at = now() where id = target.id;
  next_split := public.next_program_day(target.cycle_id);
  if next_split is not null then
    update public.method_enrollments set next_split_key = next_split, current_state = 'ready' where id = target.enrollment_id;
  end if;
  return jsonb_build_object('status', 'skipped', 'next_split_key', next_split);
end;
$$;
revoke all on function public.skip_program_day_v1(uuid) from public, anon;
grant execute on function public.skip_program_day_v1(uuid) to authenticated;

commit;
