-- Method equipment requirement + starting a method without a current one.
--
-- 1. methods.required_equipment says what a method needs, in the same vocabulary as
--    onboarding_capability_profiles.equipment_access. Every existing method needs a full
--    gym, so the default is 'full_gym' and nothing changes for them. The client lists
--    all methods and greys out the ones a user's equipment does not meet (the user can
--    still confirm and switch).
-- 2. switch_method_release_v1(release, start_day) no longer requires an active enrollment:
--    with none, it enrolls the user from their onboarding capability profile. Needed so a
--    home-training user (no default method) can start one. Behaviour with an active
--    enrollment is unchanged.
--
-- Online execution requires Sylvan's go-ahead.

begin;

alter table public.methods
  add column required_equipment text not null default 'full_gym'
    check (required_equipment in ('home_bodyweight', 'basic_equipment', 'full_gym'));

comment on column public.methods.required_equipment is
  'Minimum equipment level the method needs: home_bodyweight < basic_equipment < full_gym. Same vocabulary as onboarding_capability_profiles.equipment_access.';

create or replace function public.switch_method_release_v1(p_release_id uuid, p_start_split_key text)
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
  profile_capability_id uuid;
  profile_policy_release_id uuid;
  open_session record;
  first_split text;
  new_enrollment_id uuid;
  new_cycle_id uuid;
  ended_sessions integer := 0;
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

  if p_start_split_key is not null and not exists (
    select 1 from public.method_splits split
    where split.method_release_id = p_release_id and split.key = p_start_split_key
  ) then
    raise exception 'Unknown start day for this method' using errcode = '22023';
  end if;

  select enrollment.id, enrollment.method_release_id, enrollment.capability_profile_id,
         enrollment.adaptation_policy_release_id
  into current_enrollment
  from public.method_enrollments enrollment
  where enrollment.user_id = current_user_id and enrollment.status = 'active'
  for update;

  -- A user with no active method (for example a home-training user whose equipment has no
  -- default method) starts one from here, using their onboarding capability profile.
  if current_enrollment.id is null then
    select capability.id into profile_capability_id
    from public.onboarding_capability_profiles capability
    where capability.user_id = current_user_id;
    if profile_capability_id is null then
      raise exception 'Complete onboarding before starting a training method' using errcode = '22023';
    end if;
    select policy.id into profile_policy_release_id
    from public.adaptation_policy_releases policy
    where policy.status = 'active'
    order by policy.activated_at desc nulls last
    limit 1;
  elsif current_enrollment.method_release_id = p_release_id then
    return jsonb_build_object(
      'status', 'unchanged',
      'enrollment_id', current_enrollment.id,
      'method_release_id', p_release_id
    );
  end if;

  -- A day still open is closed with everything recorded so far (history keeps it).
  if current_enrollment.id is not null then
    for open_session in
      select session.id from public.workout_sessions session
      where session.enrollment_id = current_enrollment.id and session.status = 'started'
    loop
      perform public.end_session_early_internal(current_user_id, open_session.id, null);
      ended_sessions := ended_sessions + 1;
    end loop;

    update public.session_prescriptions
    set status = 'cancelled'
    where enrollment_id = current_enrollment.id
      and status in ('upcoming', 'ready', 'rest_deferred');

    update public.method_enrollments
    set status = 'archived'
    where id = current_enrollment.id;
  end if;

  insert into public.method_enrollments (
    user_id, method_id, method_release_id, capability_profile_id,
    adaptation_policy_release_id, status, current_cycle_number, next_split_key, current_state
  ) values (
    current_user_id, target_method_id, p_release_id,
    coalesce(current_enrollment.capability_profile_id, profile_capability_id),
    coalesce(current_enrollment.adaptation_policy_release_id, profile_policy_release_id),
    'active', 1, 'push', 'ready'
  )
  returning id into new_enrollment_id;

  first_split := coalesce(p_start_split_key, public.first_required_split_key(new_enrollment_id));
  if first_split is null then
    raise exception 'Method release has no required training day' using errcode = '22023';
  end if;

  update public.method_enrollments
  set next_split_key = first_split
  where id = new_enrollment_id;

  -- The cycle insert fires method_cycles_generate_session_prescription, which
  -- materialises the prescription of next_split_key (the chosen start day).
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
    'next_split_key', first_split,
    'ended_open_sessions', ended_sessions
  );
end;
$$;


commit;
