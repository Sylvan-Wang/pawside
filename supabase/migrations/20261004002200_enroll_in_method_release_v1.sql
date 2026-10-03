-- Method import runtime A3: atomically archive the current enrollment and join a visible release.
begin;

create function public.enroll_in_method_release_v1(p_release_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_method_id uuid;
  target_method_key text;
  target_owner_id uuid;
  target_capability_id uuid;
  target_equipment_access text;
  target_policy_release_id uuid;
  first_split_key text;
  created_enrollment_id uuid;
  created_cycle_id uuid;
  created_prescription_id uuid;
begin
  if not public.feature_enabled('multi_day_runtime') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = current_user_id and profile.onboarding_completed
  ) then
    return jsonb_build_object('status', 'unavailable', 'reason', 'ONBOARDING_INCOMPLETE');
  end if;

  select capability.id, capability.equipment_access
  into target_capability_id, target_equipment_access
  from public.onboarding_capability_profiles capability
  where capability.user_id = current_user_id;
  if target_capability_id is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'CAPABILITY_PROFILE_MISSING');
  end if;

  select method.id, method.key, method.owner_user_id
  into target_method_id, target_method_key, target_owner_id
  from public.method_releases release
  join public.methods method on method.id = release.method_id
  where release.id = p_release_id
    and release.status = 'active'
    and release.runtime_gate_status = 'passed'
    and (method.owner_user_id is null or method.owner_user_id = current_user_id);
  if target_method_id is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'METHOD_NOT_READY');
  end if;

  if target_owner_id is null
     and target_method_key = 'ksw_tcy_three_split_2026'
     and target_equipment_access <> 'full_gym' then
    return jsonb_build_object('status', 'unavailable', 'reason', 'EQUIPMENT_REVIEW_REQUIRED');
  end if;

  select split.key into first_split_key
  from public.method_splits split
  where split.method_release_id = p_release_id and split.is_required
  order by split.order_index
  limit 1;
  if first_split_key is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'METHOD_NOT_READY');
  end if;

  select policy.id into target_policy_release_id
  from public.adaptation_policy_releases policy
  where policy.status = 'active'
  order by policy.activated_at desc nulls last
  limit 1;

  update public.method_enrollments
  set status = 'archived'
  where user_id = current_user_id and status = 'active';

  insert into public.method_enrollments (
    user_id, method_id, method_release_id, capability_profile_id,
    adaptation_policy_release_id, status, current_cycle_number,
    next_split_key, current_state
  ) values (
    current_user_id, target_method_id, p_release_id, target_capability_id,
    target_policy_release_id, 'active', 1, first_split_key, 'ready'
  ) returning id into created_enrollment_id;

  insert into public.method_cycles (enrollment_id, cycle_number, status)
  values (created_enrollment_id, 1, 'in_progress')
  returning id into created_cycle_id;

  created_prescription_id := public.create_session_prescription_for_cycle_v2(created_cycle_id, current_date);

  return jsonb_build_object(
    'status', 'active',
    'reason', null,
    'enrollment_id', created_enrollment_id,
    'method_release_id', p_release_id,
    'cycle_id', created_cycle_id,
    'cycle_number', 1,
    'next_split_key', first_split_key,
    'prescription_id', created_prescription_id
  );
end;
$$;
revoke all on function public.enroll_in_method_release_v1(uuid) from public, anon;
grant execute on function public.enroll_in_method_release_v1(uuid) to authenticated;

commit;
