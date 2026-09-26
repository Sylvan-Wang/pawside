-- Pawside Phase 0: make versioned nutrition target snapshots part of the live
-- onboarding/settings/body-metric transactions and normalize profile enums.

begin;

update public.user_profiles
set goal = case goal
  when '增肌' then 'gain_muscle'
  when '减脂' then 'lose_fat'
  when '保持' then 'maintain'
  else goal
end,
gender = case gender
  when '男' then 'male'
  when '女' then 'female'
  else gender
end
where goal in ('增肌', '减脂', '保持')
   or gender in ('男', '女');

alter table public.user_profiles
  drop constraint if exists user_profiles_goal_check,
  drop constraint if exists user_profiles_gender_check;

alter table public.user_profiles
  add constraint user_profiles_goal_check
    check (goal is null or goal in ('gain_muscle', 'lose_fat', 'maintain')),
  add constraint user_profiles_gender_check
    check (gender is null or gender in ('male', 'female', 'other'));

alter table public.body_metrics
  add column if not exists client_request_id uuid;

create unique index if not exists body_metrics_request_id_idx
  on public.body_metrics(user_id, client_request_id)
  where client_request_id is not null;

-- A body metric is unique per local date, so the row's client_request_id can
-- change when the user corrects that date. Keep immutable request receipts so
-- retrying an older request never overwrites the newer correction.
create table if not exists public.body_metric_write_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  body_metric_id uuid not null references public.body_metrics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.body_metric_write_receipts enable row level security;
alter table public.body_metric_write_receipts force row level security;

drop policy if exists body_metric_write_receipts_manage_own on public.body_metric_write_receipts;
create policy body_metric_write_receipts_manage_own on public.body_metric_write_receipts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.persist_nutrition_target_snapshot_v1(
  p_user_id uuid,
  p_target_effective_date date,
  p_calorie_target_kcal integer,
  p_protein_target_g numeric,
  p_carb_target_g numeric,
  p_fat_target_g numeric,
  p_target_source text,
  p_macro_target_status text,
  p_target_calculation_basis jsonb,
  p_target_evidence_ref_ids text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snapshot_id uuid;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'nutrition target ownership mismatch' using errcode = '42501';
  end if;
  if p_target_effective_date is null
     or p_target_source not in ('user_target', 'missing')
     or p_macro_target_status not in ('ok', 'needs_review', 'insufficient_data')
     or p_target_calculation_basis is null then
    raise exception 'invalid nutrition target snapshot' using errcode = '22023';
  end if;

  insert into public.nutrition_targets (
    user_id,
    effective_date,
    calorie_target_kcal,
    protein_target_g,
    carb_target_g,
    fat_target_g,
    source,
    macro_target_status,
    calculation_basis,
    evidence_ref_ids,
    updated_at
  ) values (
    p_user_id,
    p_target_effective_date,
    p_calorie_target_kcal,
    p_protein_target_g,
    p_carb_target_g,
    p_fat_target_g,
    p_target_source,
    p_macro_target_status,
    p_target_calculation_basis,
    coalesce(p_target_evidence_ref_ids, '{}'::text[]),
    now()
  )
  on conflict (user_id, effective_date) do update set
    calorie_target_kcal = excluded.calorie_target_kcal,
    protein_target_g = excluded.protein_target_g,
    carb_target_g = excluded.carb_target_g,
    fat_target_g = excluded.fat_target_g,
    source = excluded.source,
    macro_target_status = excluded.macro_target_status,
    calculation_basis = excluded.calculation_basis,
    evidence_ref_ids = excluded.evidence_ref_ids,
    updated_at = now()
  returning id into snapshot_id;

  return snapshot_id;
end;
$$;

create or replace function public.complete_phase2_onboarding_v3(
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
  p_target_effective_date date,
  p_protein_target_g numeric,
  p_carb_target_g numeric,
  p_fat_target_g numeric,
  p_target_source text,
  p_macro_target_status text,
  p_target_calculation_basis jsonb,
  p_target_evidence_ref_ids text[],
  p_join_method boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  onboarding_result jsonb;
  target_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  onboarding_result := public.complete_phase2_onboarding_v2(
    p_goal,
    p_gender,
    p_height_cm,
    p_reference_weight_kg,
    p_weight_unit,
    p_training_experience,
    p_pushup_capacity,
    p_equipment_access,
    p_preferred_session_minutes,
    p_daily_calorie_target,
    p_weekly_workout_target,
    p_join_method
  );

  target_id := public.persist_nutrition_target_snapshot_v1(
    current_user_id,
    p_target_effective_date,
    p_daily_calorie_target,
    p_protein_target_g,
    p_carb_target_g,
    p_fat_target_g,
    p_target_source,
    p_macro_target_status,
    p_target_calculation_basis,
    p_target_evidence_ref_ids
  );

  return onboarding_result || jsonb_build_object(
    'nutrition_target', jsonb_build_object(
      'id', target_id,
      'effective_date', p_target_effective_date,
      'status', p_macro_target_status,
      'source', p_target_source
    )
  );
end;
$$;

create or replace function public.update_profile_targets_v1(
  p_gender text,
  p_height_cm numeric,
  p_weight_kg numeric,
  p_weight_unit text,
  p_goal text,
  p_weekly_workout_target integer,
  p_daily_calorie_target integer,
  p_target_effective_date date,
  p_protein_target_g numeric,
  p_carb_target_g numeric,
  p_fat_target_g numeric,
  p_target_source text,
  p_macro_target_status text,
  p_target_calculation_basis jsonb,
  p_target_evidence_ref_ids text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_gender not in ('male', 'female', 'other')
     or p_goal not in ('gain_muscle', 'lose_fat', 'maintain')
     or p_height_cm <= 0 or p_height_cm > 300
     or p_weight_kg <= 0 or p_weight_kg > 500
     or p_weight_unit not in ('kg', 'lb') then
    raise exception 'invalid profile input' using errcode = '22023';
  end if;
  if p_weekly_workout_target is not null
     and (p_weekly_workout_target < 1 or p_weekly_workout_target > 21) then
    raise exception 'invalid weekly workout target' using errcode = '22023';
  end if;
  if p_daily_calorie_target is not null
     and (p_daily_calorie_target < 500 or p_daily_calorie_target > 20000) then
    raise exception 'invalid daily calorie target' using errcode = '22023';
  end if;

  update public.user_profiles set
    gender = p_gender,
    height_cm = p_height_cm,
    weight_kg = p_weight_kg,
    reference_weight_kg = p_weight_kg,
    weight_unit = p_weight_unit,
    goal = p_goal,
    weekly_workout_target = p_weekly_workout_target,
    daily_calorie_target = p_daily_calorie_target,
    updated_at = now()
  where id = current_user_id;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  target_id := public.persist_nutrition_target_snapshot_v1(
    current_user_id,
    p_target_effective_date,
    p_daily_calorie_target,
    p_protein_target_g,
    p_carb_target_g,
    p_fat_target_g,
    p_target_source,
    p_macro_target_status,
    p_target_calculation_basis,
    p_target_evidence_ref_ids
  );

  return jsonb_build_object(
    'profile_updated', true,
    'nutrition_target_id', target_id,
    'target_effective_date', p_target_effective_date
  );
end;
$$;

create or replace function public.save_body_metric_with_target_v1(
  p_request_id uuid,
  p_metric jsonb,
  p_target_effective_date date,
  p_calorie_target_kcal integer,
  p_protein_target_g numeric,
  p_carb_target_g numeric,
  p_fat_target_g numeric,
  p_target_source text,
  p_macro_target_status text,
  p_target_calculation_basis jsonb,
  p_target_evidence_ref_ids text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_metric_id uuid;
  metric_id uuid;
  target_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null or p_metric is null or (p_metric->>'date') is null then
    raise exception 'invalid body metric request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || p_request_id::text, 0)
  );

  select body_metric_id into existing_metric_id
  from public.body_metric_write_receipts
  where user_id = current_user_id and request_id = p_request_id;

  if existing_metric_id is not null then
    return jsonb_build_object(
      'body_metric_id', existing_metric_id,
      'target_effective_date', p_target_effective_date,
      'idempotent', true
    );
  end if;

  insert into public.body_metrics (
    user_id, date, weight_kg, body_fat_pct, muscle_mass, chest_cm, waist_cm,
    hip_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm,
    left_calf_cm, right_calf_cm, custom_metrics, notes, client_request_id
  ) values (
    current_user_id,
    (p_metric->>'date')::date,
    nullif(p_metric->>'weight_kg', '')::numeric,
    nullif(p_metric->>'body_fat_pct', '')::numeric,
    nullif(p_metric->>'muscle_mass', '')::numeric,
    nullif(p_metric->>'chest_cm', '')::numeric,
    nullif(p_metric->>'waist_cm', '')::numeric,
    nullif(p_metric->>'hip_cm', '')::numeric,
    nullif(p_metric->>'left_arm_cm', '')::numeric,
    nullif(p_metric->>'right_arm_cm', '')::numeric,
    nullif(p_metric->>'left_thigh_cm', '')::numeric,
    nullif(p_metric->>'right_thigh_cm', '')::numeric,
    nullif(p_metric->>'left_calf_cm', '')::numeric,
    nullif(p_metric->>'right_calf_cm', '')::numeric,
    coalesce(nullif(p_metric->'custom_metrics', 'null'::jsonb), '{}'::jsonb),
    nullif(p_metric->>'notes', ''),
    p_request_id
  )
  on conflict (user_id, date) do update set
    weight_kg = excluded.weight_kg,
    body_fat_pct = excluded.body_fat_pct,
    muscle_mass = excluded.muscle_mass,
    chest_cm = excluded.chest_cm,
    waist_cm = excluded.waist_cm,
    hip_cm = excluded.hip_cm,
    left_arm_cm = excluded.left_arm_cm,
    right_arm_cm = excluded.right_arm_cm,
    left_thigh_cm = excluded.left_thigh_cm,
    right_thigh_cm = excluded.right_thigh_cm,
    left_calf_cm = excluded.left_calf_cm,
    right_calf_cm = excluded.right_calf_cm,
    custom_metrics = excluded.custom_metrics,
    notes = excluded.notes,
    client_request_id = excluded.client_request_id,
    updated_at = now()
  returning id into metric_id;

  target_id := public.persist_nutrition_target_snapshot_v1(
    current_user_id,
    p_target_effective_date,
    p_calorie_target_kcal,
    p_protein_target_g,
    p_carb_target_g,
    p_fat_target_g,
    p_target_source,
    p_macro_target_status,
    p_target_calculation_basis,
    p_target_evidence_ref_ids
  );

  insert into public.body_metric_write_receipts (user_id, request_id, body_metric_id)
  values (current_user_id, p_request_id, metric_id);

  return jsonb_build_object(
    'body_metric_id', metric_id,
    'nutrition_target_id', target_id,
    'target_effective_date', p_target_effective_date,
    'idempotent', false
  );
end;
$$;

revoke all on function public.persist_nutrition_target_snapshot_v1(uuid, date, integer, numeric, numeric, numeric, text, text, jsonb, text[]) from public, anon;
revoke all on function public.complete_phase2_onboarding_v3(text, text, numeric, numeric, text, text, text, text, integer, integer, integer, date, numeric, numeric, numeric, text, text, jsonb, text[], boolean) from public, anon;
revoke all on function public.update_profile_targets_v1(text, numeric, numeric, text, text, integer, integer, date, numeric, numeric, numeric, text, text, jsonb, text[]) from public, anon;
revoke all on function public.save_body_metric_with_target_v1(uuid, jsonb, date, integer, numeric, numeric, numeric, text, text, jsonb, text[]) from public, anon;

grant execute on function public.persist_nutrition_target_snapshot_v1(uuid, date, integer, numeric, numeric, numeric, text, text, jsonb, text[]) to authenticated;
grant execute on function public.complete_phase2_onboarding_v3(text, text, numeric, numeric, text, text, text, text, integer, integer, integer, date, numeric, numeric, numeric, text, text, jsonb, text[], boolean) to authenticated;
grant execute on function public.update_profile_targets_v1(text, numeric, numeric, text, text, integer, integer, date, numeric, numeric, numeric, text, text, jsonb, text[]) to authenticated;
grant execute on function public.save_body_metric_with_target_v1(uuid, jsonb, date, integer, numeric, numeric, numeric, text, text, jsonb, text[]) to authenticated;

commit;
