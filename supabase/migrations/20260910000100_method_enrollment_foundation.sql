-- Pawside 2.0 Phase 2: lightweight capability profile and release-pinned enrollment.

begin;

create table public.onboarding_capability_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  training_experience text not null check (
    training_experience in ('new_to_structured', 'some_experience', 'consistent')
  ),
  pushup_capacity text not null check (
    pushup_capacity in ('not_yet', 'one_to_five', 'six_to_fifteen', 'sixteen_plus', 'unsure')
  ),
  equipment_access text not null check (
    equipment_access in ('full_gym', 'basic_equipment', 'home_bodyweight')
  ),
  preferred_session_minutes integer not null check (
    preferred_session_minutes in (30, 45, 60, 90)
  ),
  constraints text[] not null default '{}',
  answers_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.onboarding_capability_profiles is
  'Lightweight range-narrowing inputs. Never convert a push-up answer directly into a prescribed weight.';

create trigger onboarding_capability_profiles_set_updated_at
  before update on public.onboarding_capability_profiles
  for each row execute function public.set_updated_at();

alter table public.onboarding_capability_profiles enable row level security;
alter table public.onboarding_capability_profiles force row level security;

create policy onboarding_capability_profiles_select_own
  on public.onboarding_capability_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy onboarding_capability_profiles_insert_own
  on public.onboarding_capability_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy onboarding_capability_profiles_update_own
  on public.onboarding_capability_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.onboarding_capability_profiles from anon;
grant select, insert, update on table public.onboarding_capability_profiles to authenticated;

alter table public.method_enrollments
  add column method_release_id uuid references public.method_releases(id) on delete restrict,
  add column capability_profile_id uuid references public.onboarding_capability_profiles(id) on delete set null,
  add column adaptation_policy_release_id uuid references public.adaptation_policy_releases(id) on delete restrict,
  add column pause_reason text,
  add column paused_at timestamptz,
  add column resumed_at timestamptz;

alter table public.method_enrollments
  add constraint method_enrollments_active_release_pin_check
  check (status <> 'active' or method_release_id is not null) not valid;

create index method_enrollments_method_release_id_idx
  on public.method_enrollments(method_release_id);
create index method_enrollments_capability_profile_id_idx
  on public.method_enrollments(capability_profile_id);
create index method_enrollments_policy_release_id_idx
  on public.method_enrollments(adaptation_policy_release_id);

create or replace function public.initialize_current_method_enrollment()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_method_id uuid;
  target_release_id uuid;
  target_policy_release_id uuid;
  target_capability_id uuid;
  target_equipment_access text;
  existing_enrollment_id uuid;
  existing_enrollment_status text;
  created_enrollment_id uuid;
  created_cycle_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = current_user_id
      and profile.onboarding_completed
  ) then
    return jsonb_build_object(
      'status', 'unavailable',
      'reason', 'ONBOARDING_INCOMPLETE'
    );
  end if;

  select capability.id, capability.equipment_access
  into target_capability_id, target_equipment_access
  from public.onboarding_capability_profiles capability
  where capability.user_id = current_user_id;

  if target_capability_id is null then
    return jsonb_build_object(
      'status', 'unavailable',
      'reason', 'CAPABILITY_PROFILE_MISSING'
    );
  end if;

  if target_equipment_access <> 'full_gym' then
    return jsonb_build_object(
      'status', 'unavailable',
      'reason', 'EQUIPMENT_REVIEW_REQUIRED'
    );
  end if;

  select method.id, release.id
  into target_method_id, target_release_id
  from public.method_releases release
  join public.methods method on method.id = release.method_id
  where method.key = 'ksw_tcy_three_split_2026'
    and release.status = 'active'
    and release.runtime_gate_status = 'passed'
  order by
    case release.release_channel when 'production' then 0 else 1 end,
    release.activated_at desc nulls last
  limit 1;

  if target_release_id is null then
    return jsonb_build_object(
      'status', 'unavailable',
      'reason', 'METHOD_NOT_READY'
    );
  end if;

  select policy.id
  into target_policy_release_id
  from public.adaptation_policy_releases policy
  where policy.status = 'active'
  order by policy.activated_at desc nulls last
  limit 1;

  select enrollment.id, enrollment.status
  into existing_enrollment_id, existing_enrollment_status
  from public.method_enrollments enrollment
  where enrollment.user_id = current_user_id
    and enrollment.method_release_id = target_release_id
    and enrollment.status in ('active', 'paused')
  order by enrollment.started_at desc
  limit 1;

  if existing_enrollment_id is not null then
    return jsonb_build_object(
      'status', existing_enrollment_status,
      'reason', case when existing_enrollment_status = 'paused' then 'METHOD_PAUSED' else null end,
      'enrollment_id', existing_enrollment_id,
      'method_release_id', target_release_id
    );
  end if;

  insert into public.method_enrollments (
    user_id,
    method_id,
    method_release_id,
    capability_profile_id,
    adaptation_policy_release_id,
    status,
    current_cycle_number,
    next_split_key,
    current_state
  )
  values (
    current_user_id,
    target_method_id,
    target_release_id,
    target_capability_id,
    target_policy_release_id,
    'active',
    1,
    'push',
    'ready'
  )
  returning id into created_enrollment_id;

  insert into public.method_cycles (
    enrollment_id,
    cycle_number,
    status
  )
  values (
    created_enrollment_id,
    1,
    'in_progress'
  )
  returning id into created_cycle_id;

  return jsonb_build_object(
    'status', 'active',
    'reason', null,
    'enrollment_id', created_enrollment_id,
    'method_release_id', target_release_id,
    'cycle_id', created_cycle_id,
    'cycle_number', 1,
    'next_split_key', 'push'
  );
end;
$$;

create or replace function public.complete_phase2_onboarding(
  p_goal text,
  p_gender text,
  p_height_cm numeric,
  p_reference_weight_kg numeric,
  p_weight_unit text,
  p_training_experience text,
  p_pushup_capacity text,
  p_equipment_access text,
  p_preferred_session_minutes integer,
  p_join_method boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  capability_id uuid;
  enrollment_result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_goal not in ('gain_muscle', 'lose_fat', 'maintain')
     or p_gender not in ('male', 'female', 'other')
     or p_height_cm <= 0 or p_height_cm > 300
     or p_reference_weight_kg <= 0 or p_reference_weight_kg > 500
     or p_weight_unit not in ('kg', 'lb')
     or p_training_experience not in ('new_to_structured', 'some_experience', 'consistent')
     or p_pushup_capacity not in ('not_yet', 'one_to_five', 'six_to_fifteen', 'sixteen_plus', 'unsure')
     or p_equipment_access not in ('full_gym', 'basic_equipment', 'home_bodyweight')
     or p_preferred_session_minutes not in (30, 45, 60, 90) then
    raise exception 'Invalid onboarding input' using errcode = '22023';
  end if;

  insert into public.user_profiles (
    id,
    email,
    goal,
    gender,
    height_cm,
    reference_weight_kg,
    weight_kg,
    weight_unit,
    onboarding_completed,
    onboarding_version
  )
  select
    current_user_id,
    auth_user.email,
    p_goal,
    p_gender,
    p_height_cm,
    p_reference_weight_kg,
    p_reference_weight_kg,
    p_weight_unit,
    true,
    '2.0-phase2'
  from auth.users auth_user
  where auth_user.id = current_user_id
  on conflict (id) do update set
    email = excluded.email,
    goal = excluded.goal,
    gender = excluded.gender,
    height_cm = excluded.height_cm,
    reference_weight_kg = excluded.reference_weight_kg,
    weight_kg = excluded.weight_kg,
    weight_unit = excluded.weight_unit,
    onboarding_completed = excluded.onboarding_completed,
    onboarding_version = excluded.onboarding_version;

  insert into public.onboarding_capability_profiles (
    user_id,
    training_experience,
    pushup_capacity,
    equipment_access,
    preferred_session_minutes,
    answers_version
  )
  values (
    current_user_id,
    p_training_experience,
    p_pushup_capacity,
    p_equipment_access,
    p_preferred_session_minutes,
    '2.0-phase2'
  )
  on conflict (user_id) do update set
    training_experience = excluded.training_experience,
    pushup_capacity = excluded.pushup_capacity,
    equipment_access = excluded.equipment_access,
    preferred_session_minutes = excluded.preferred_session_minutes,
    answers_version = excluded.answers_version
  returning id into capability_id;

  if p_join_method then
    enrollment_result := public.initialize_current_method_enrollment();
  else
    enrollment_result := jsonb_build_object(
      'status', 'not_requested',
      'reason', null
    );
  end if;

  return jsonb_build_object(
    'profile',
    jsonb_build_object(
      'id', current_user_id,
      'goal', p_goal,
      'gender', p_gender,
      'height_cm', p_height_cm,
      'reference_weight_kg', p_reference_weight_kg,
      'weight_unit', p_weight_unit,
      'onboarding_completed', true,
      'onboarding_version', '2.0-phase2'
    ),
    'capability_profile',
    jsonb_build_object(
      'id', capability_id,
      'training_experience', p_training_experience,
      'pushup_capacity', p_pushup_capacity,
      'equipment_access', p_equipment_access,
      'preferred_session_minutes', p_preferred_session_minutes,
      'answers_version', '2.0-phase2'
    ),
    'method', enrollment_result
  );
end;
$$;

revoke all on function public.initialize_current_method_enrollment() from public, anon;
revoke all on function public.complete_phase2_onboarding(
  text, text, numeric, numeric, text, text, text, text, integer, boolean
) from public, anon;
grant execute on function public.initialize_current_method_enrollment() to authenticated;
grant execute on function public.complete_phase2_onboarding(
  text, text, numeric, numeric, text, text, text, text, integer, boolean
) to authenticated;

comment on function public.initialize_current_method_enrollment() is
  'Atomically pins an authenticated user to the currently active release and creates Cycle 1 / Push.';
comment on function public.complete_phase2_onboarding(
  text, text, numeric, numeric, text, text, text, text, integer, boolean
) is
  'Atomically saves base and capability onboarding, then attempts release-pinned enrollment.';

commit;
