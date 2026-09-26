-- Rollback-only authenticated fixture for canonical profile enums, target
-- snapshots, and idempotent body-metric target refresh.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '30000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'profile-target-fixture@pawside.test',
  '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.user_profiles (
  id, email, gender, height_cm, weight_kg, reference_weight_kg, weight_unit,
  goal, weekly_workout_target, daily_calorie_target, onboarding_completed
) values (
  '30000000-0000-4000-8000-000000000001',
  'profile-target-fixture@pawside.test',
  'male', 180, 80, 80, 'kg', 'maintain', 3, 2200, true
)
on conflict (id) do update set
  gender = excluded.gender,
  height_cm = excluded.height_cm,
  weight_kg = excluded.weight_kg,
  reference_weight_kg = excluded.reference_weight_kg,
  weight_unit = excluded.weight_unit,
  goal = excluded.goal,
  weekly_workout_target = excluded.weekly_workout_target,
  daily_calorie_target = excluded.daily_calorie_target;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $test$
declare
  fixture_user_id uuid := '30000000-0000-4000-8000-000000000001';
  request_id uuid := '40000000-0000-4000-8000-000000000001';
  correction_request_id uuid := '40000000-0000-4000-8000-000000000002';
  first_result jsonb;
  retry_result jsonb;
  correction_result jsonb;
  target_status text;
  metric_count integer;
  receipt_count integer;
  saved_weight numeric;
begin
  perform public.update_profile_targets_v1(
    'female', 168, 65, 'kg', 'lose_fat', 4, 1800,
    date '2026-09-26', 104, 233.5, 50,
    'user_target', 'ok',
    jsonb_build_object(
      'formula_version', 'pawside_macro_v1',
      'daily_calorie_target_kcal', 1800,
      'weight_kg', 65,
      'protein_g_per_kg', 1.6,
      'fat_energy_ratio', 0.25,
      'reason', null
    ),
    array['E-NUT-PROTEIN-OP', 'E-NUT-MACRO-DIST']
  );

  if not exists (
    select 1 from public.user_profiles
    where id = fixture_user_id and goal = 'lose_fat' and gender = 'female'
  ) then
    raise exception 'canonical profile enums were not persisted';
  end if;

  select macro_target_status into target_status
  from public.nutrition_targets
  where user_id = fixture_user_id and effective_date = date '2026-09-26'
    and calculation_basis->>'formula_version' = 'pawside_macro_v1';
  if target_status is distinct from 'ok' then
    raise exception 'settings target snapshot was not persisted';
  end if;

  first_result := public.save_body_metric_with_target_v1(
    request_id,
    jsonb_build_object(
      'date', '2026-09-27',
      'weight_kg', 64.5,
      'body_fat_pct', null,
      'muscle_mass', null,
      'chest_cm', null,
      'waist_cm', null,
      'hip_cm', null,
      'left_arm_cm', null,
      'right_arm_cm', null,
      'left_thigh_cm', null,
      'right_thigh_cm', null,
      'left_calf_cm', null,
      'right_calf_cm', null,
      'custom_metrics', null,
      'notes', null
    ),
    date '2026-09-27', 1800, 103.2, 234.3, 50,
    'user_target', 'ok',
    jsonb_build_object(
      'formula_version', 'pawside_macro_v1',
      'daily_calorie_target_kcal', 1800,
      'weight_kg', 64.5,
      'protein_g_per_kg', 1.6,
      'fat_energy_ratio', 0.25,
      'reason', null
    ),
    array['E-NUT-PROTEIN-OP', 'E-NUT-MACRO-DIST']
  );

  correction_result := public.save_body_metric_with_target_v1(
    correction_request_id,
    jsonb_build_object('date', '2026-09-27', 'weight_kg', 64),
    date '2026-09-27', 1800, 102.4, 235.1, 50,
    'user_target', 'ok', jsonb_build_object('weight_kg', 64), '{}'::text[]
  );

  retry_result := public.save_body_metric_with_target_v1(
    request_id,
    jsonb_build_object('date', '2026-09-27', 'weight_kg', 1),
    date '2026-09-27', 1800, 103.2, 234.3, 50,
    'user_target', 'ok', '{}'::jsonb, '{}'::text[]
  );

  select count(*) into metric_count
  from public.body_metrics
  where user_id = fixture_user_id and client_request_id = request_id;

  select count(*) into receipt_count
  from public.body_metric_write_receipts
  where user_id = fixture_user_id;

  select weight_kg into saved_weight
  from public.body_metrics
  where user_id = fixture_user_id and date = date '2026-09-27';

  if (first_result->>'idempotent')::boolean
     or not (retry_result->>'idempotent')::boolean
     or (correction_result->>'idempotent')::boolean
     or metric_count <> 0
     or receipt_count <> 2
     or saved_weight <> 64 then
    raise exception 'body metric request idempotency failed';
  end if;

  if not exists (
    select 1 from public.nutrition_targets
    where user_id = fixture_user_id
      and effective_date = date '2026-09-27'
      and calculation_basis->>'weight_kg' = '64.5'
  ) then
    raise exception 'body metric did not refresh target provenance';
  end if;
end;
$test$;

rollback;
