-- Pawside — Onboarding target layer: daily calorie target + weekly workout target.
--
begin;

-- Why this migration exists
-- -------------------------
-- Product & UX Loop Patch v2.0 §4 requires the user to actively set a daily
-- calorie target, and §3.1 lists the weekly training target as a retained
-- Onboarding field. Neither was ever collected by onboarding: the request
-- contract carried no such parameters, so the only writer was Settings, which
-- fabricated a value when the field was blank.
--
-- Before: app/settings/page.tsx wrote
--     weekly_workout_target = Number(form.weekly_workout_target) || 3
--     daily_calorie_target  = Number(form.daily_calorie_target)  || 2000
-- which destroyed the "target not set" state that Phase 0 baseline §3.2
-- requires to be representable as NULL.
--
-- Shape of this change (Guardrail §13 / §18 — additive only):
--   * new function `complete_phase2_onboarding_v2` with two added parameters
--   * no table/column added or dropped; user_profiles already has both columns
--     (20260904000100_legacy_compatibility_schema.sql:32-33)
--   * the original `complete_phase2_onboarding` is deliberately LEFT INTACT so
--     the released signature keeps executing; there is no argument-ambiguity
--     workaround and nothing to roll back
--
-- Signature verification note
-- ---------------------------
-- The current v1 source already places its only defaulted parameter last
-- (20260910000100_method_enrollment_foundation.sql:221-232). An earlier DSH
-- handoff reported SQLSTATE 42P13 from a stale signature; that claim does not
-- match the repository source. Fresh replay is still required independently.
--
-- Storage unit decision
-- ---------------------
-- `user_profiles.daily_calorie_target` is `integer` (20260904000100:33).
-- Calories are whole-number in this product's UI, so the parameter is integer
-- and the column is untouched. Macro targets are NOT added here: Product Patch
-- §4.1 makes them derived, not user-entered, so they are computed by
-- lib/nutrition/macro-targets.ts (AI Patch §12.1) and persisted in the
-- normalized nutrition work, not as onboarding inputs.

create or replace function public.complete_phase2_onboarding_v2(
  p_goal text,
  p_gender text,
  p_height_cm numeric,
  p_reference_weight_kg numeric,
  p_weight_unit text,
  p_training_experience text,
  p_pushup_capacity text,
  p_equipment_access text,
  p_preferred_session_minutes integer,
  p_daily_calorie_target integer,
  p_weekly_workout_target integer,
  -- PostgreSQL requires a defaulted parameter to remain after all parameters
  -- without defaults, so p_join_method stays final.
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

  -- Target layer guards.
  --
  -- Provenance (Guardrail §2.2): these are tamper ceilings, NOT health
  -- thresholds. AI Patch §14 / E-NUT-SAFE-001 record that there is no universal
  -- calorie floor for this product, so no lower "danger" bound is enforced.
  -- NULL is a first-class value meaning "user has not set a target" and is
  -- preserved as NULL (Product Patch §27; Phase 0 baseline §3.2).
  if p_daily_calorie_target is not null
     and (p_daily_calorie_target < 500 or p_daily_calorie_target > 20000) then
    raise exception 'Invalid daily calorie target' using errcode = '22023';
  end if;

  if p_weekly_workout_target is not null
     and (p_weekly_workout_target < 1 or p_weekly_workout_target > 21) then
    raise exception 'Invalid weekly workout target' using errcode = '22023';
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
    onboarding_version,
    daily_calorie_target,
    weekly_workout_target
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
    '2.0-phase3',
    p_daily_calorie_target,
    p_weekly_workout_target
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
    onboarding_version = excluded.onboarding_version,
    daily_calorie_target = excluded.daily_calorie_target,
    weekly_workout_target = excluded.weekly_workout_target;

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
      'onboarding_version', '2.0-phase3',
      'daily_calorie_target', p_daily_calorie_target,
      'weekly_workout_target', p_weekly_workout_target
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

-- Match the hardening precedent of the v1 function
-- (20260910000100_method_enrollment_foundation.sql:355-361).
revoke all on function public.complete_phase2_onboarding_v2(
  text, text, numeric, numeric, text, text, text, text, integer, integer, integer, boolean
) from public, anon;
grant execute on function public.complete_phase2_onboarding_v2(
  text, text, numeric, numeric, text, text, text, text, integer, integer, integer, boolean
) to authenticated;

comment on function public.complete_phase2_onboarding_v2(
  text, text, numeric, numeric, text, text, text, text, integer, integer, integer, boolean
) is
  'Atomically saves base onboarding plus the Target layer (daily calorie target, weekly workout target), '
  'then attempts release-pinned enrollment. v2 supersedes complete_phase2_onboarding, which is retained '
  'unchanged so the released signature keeps working. Both target parameters accept NULL meaning '
  '"not set"; bounds are tamper guards, not health thresholds.';

comment on column public.user_profiles.daily_calorie_target is
  'User-set daily calorie target (Product Patch §4). NULL means the user has not set a target and must '
  'render as no target rather than a default. Not a safety threshold.';

comment on column public.user_profiles.weekly_workout_target is
  'User-set weekly training target. NULL means not set. Compatibility/UX field; never Method adherence truth.';

commit;
