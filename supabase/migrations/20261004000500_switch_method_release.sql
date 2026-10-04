-- Four-split method · step 4: switching the training method.
--
-- switch_method_release_v1 archives the user's active enrollment and creates a new
-- one on the chosen release in ONE transaction. It never deletes anything:
-- workout_sessions / exercise_executions / set_executions / workout_logs stay
-- attached to the archived enrollment (their foreign keys cascade on DELETE, so
-- deleting an enrollment would erase history; this function only changes status).
-- Switching back later creates a fresh enrollment; history is never "revived".

begin;

create or replace function public.switch_method_release_v1(p_release_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_method_id uuid;
  target_method_name text;
  current_enrollment record;
  started_session_id uuid;
  first_split text;
  new_enrollment_id uuid;
  new_cycle_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select release.method_id, method.name into target_method_id, target_method_name
  from public.method_releases release
  join public.methods method on method.id = release.method_id
  where release.id = p_release_id
    and release.status = 'active'
    and release.runtime_gate_status = 'passed';
  if target_method_id is null then
    raise exception 'Method release is not available' using errcode = 'P0002';
  end if;

  select enrollment.id, enrollment.method_release_id, enrollment.capability_profile_id,
         enrollment.adaptation_policy_release_id
  into current_enrollment
  from public.method_enrollments enrollment
  where enrollment.user_id = current_user_id and enrollment.status = 'active'
  for update;

  if current_enrollment.id is null then
    raise exception 'No active training method to switch from' using errcode = 'P0002';
  end if;

  if current_enrollment.method_release_id = p_release_id then
    return jsonb_build_object(
      'status', 'unchanged',
      'enrollment_id', current_enrollment.id,
      'method_release_id', p_release_id
    );
  end if;

  select session.id into started_session_id
  from public.workout_sessions session
  where session.enrollment_id = current_enrollment.id and session.status = 'started'
  limit 1;
  if started_session_id is not null then
    raise exception 'Finish or leave the training in progress before switching' using errcode = '55000';
  end if;

  update public.session_prescriptions
  set status = 'cancelled'
  where enrollment_id = current_enrollment.id
    and status in ('upcoming', 'ready', 'rest_deferred');

  update public.method_enrollments
  set status = 'archived'
  where id = current_enrollment.id;

  insert into public.method_enrollments (
    user_id, method_id, method_release_id, capability_profile_id,
    adaptation_policy_release_id, status, current_cycle_number, next_split_key, current_state
  ) values (
    current_user_id, target_method_id, p_release_id, current_enrollment.capability_profile_id,
    current_enrollment.adaptation_policy_release_id, 'active', 1, 'push', 'ready'
  )
  returning id into new_enrollment_id;

  first_split := public.first_required_split_key(new_enrollment_id);
  if first_split is null then
    raise exception 'Method release has no required training day' using errcode = '22023';
  end if;

  update public.method_enrollments
  set next_split_key = first_split
  where id = new_enrollment_id;

  -- The cycle insert fires method_cycles_generate_session_prescription, which
  -- materialises the first day's prescription.
  insert into public.method_cycles (enrollment_id, cycle_number, status)
  values (new_enrollment_id, 1, 'in_progress')
  returning id into new_cycle_id;

  return jsonb_build_object(
    'status', 'switched',
    'enrollment_id', new_enrollment_id,
    'previous_enrollment_id', current_enrollment.id,
    'method_release_id', p_release_id,
    'method_name', target_method_name,
    'cycle_id', new_cycle_id,
    'next_split_key', first_split
  );
end;
$$;

revoke all on function public.switch_method_release_v1(uuid) from public, anon;
grant execute on function public.switch_method_release_v1(uuid) to authenticated;

comment on function public.switch_method_release_v1(uuid) is
  'Archives the active enrollment and enrolls the user in another active Method release in one transaction. Never deletes training history.';

commit;
