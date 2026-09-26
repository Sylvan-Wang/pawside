-- Real rollback-only fixture for the canonical nutrition transaction.
-- Exercises authenticated RLS, idempotency, nullable completeness, date move,
-- compatibility projection, and delete reconciliation.

begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'canonical-nutrition-fixture@pawside.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $test$
declare
  fixture_user_id uuid := '10000000-0000-4000-8000-000000000001';
  fixture_request_id uuid := '20000000-0000-4000-8000-000000000001';
  first_result jsonb;
  retry_result jsonb;
  canonical_id uuid;
  legacy_id uuid;
  canonical_count integer;
  item_count integer;
  total_energy numeric;
  protein_status text;
begin
  first_result := public.save_food_log_canonical_v1(
    fixture_request_id,
    date '2026-09-26',
    'lunch',
    null,
    'contract fixture',
    jsonb_build_array(jsonb_build_object(
      'food_id', null,
      'food_name_raw', 'fixture rice',
      'food_name_resolved', 'fixture rice',
      'weight_g', 200,
      'quantity', null,
      'unit', 'g',
      'is_estimated', true,
      'energy_kcal', 228,
      'protein_g', 5,
      'carb_g', 51.2,
      'fat_g', 0.4,
      'calculation_basis', jsonb_build_object('basis_type', 'manual_fixture')
    )),
    jsonb_build_array(jsonb_build_object(
      'name', 'fixture rice',
      'weight_g', 200,
      'calories', 228,
      'protein_g', 5,
      'carbs_g', 51.2,
      'fat_g', 0.4,
      'is_estimated', true
    )),
    null
  );

  canonical_id := (first_result->>'food_log_id')::uuid;
  legacy_id := (first_result->>'legacy_food_log_id')::uuid;
  if (first_result->>'idempotent')::boolean then
    raise exception 'first canonical nutrition write cannot be idempotent';
  end if;

  retry_result := public.save_food_log_canonical_v1(
    fixture_request_id,
    date '2026-09-26',
    'lunch',
    null,
    'retry must not duplicate',
    jsonb_build_array(jsonb_build_object(
      'food_name_raw', 'different retry payload',
      'weight_g', 999,
      'is_estimated', true
    )),
    '[]'::jsonb,
    null
  );

  if not (retry_result->>'idempotent')::boolean
     or (retry_result->>'food_log_id')::uuid <> canonical_id then
    raise exception 'nutrition request id is not idempotent';
  end if;

  select count(*) into canonical_count
  from public.user_food_logs
  where user_id = fixture_user_id and client_request_id = fixture_request_id;
  select count(*) into item_count
  from public.user_food_log_items
  where food_log_id = canonical_id;
  select total_energy_kcal into total_energy
  from public.daily_nutrition_summary
  where user_id = fixture_user_id and log_date = date '2026-09-26';

  if canonical_count <> 1 or item_count <> 1 or total_energy <> 228 then
    raise exception 'canonical create fixture did not close: logs %, items %, energy %',
      canonical_count, item_count, total_energy;
  end if;
  if not exists (
    select 1 from public.food_logs
    where id = legacy_id and canonical_food_log_id = canonical_id
  ) then
    raise exception 'legacy projection is not linked to canonical meal';
  end if;

  perform public.replace_food_log_canonical_v1(
    canonical_id,
    date '2026-09-25',
    'dinner',
    null,
    'moved fixture',
    jsonb_build_array(jsonb_build_object(
      'food_id', null,
      'food_name_raw', 'unknown-protein fixture',
      'food_name_resolved', null,
      'weight_g', 100,
      'quantity', null,
      'unit', 'g',
      'is_estimated', true,
      'energy_kcal', 100,
      'protein_g', null,
      'carb_g', 10,
      'fat_g', null,
      'calculation_basis', jsonb_build_object('basis_type', 'manual_fixture')
    )),
    jsonb_build_array(jsonb_build_object(
      'name', 'unknown-protein fixture',
      'weight_g', 100,
      'calories', 100,
      'protein_g', null,
      'carbs_g', 10,
      'fat_g', null,
      'is_estimated', true
    )),
    null
  );

  if exists (
    select 1 from public.daily_nutrition_summary
    where user_id = fixture_user_id and log_date = date '2026-09-26'
  ) then
    raise exception 'old date summary survived a canonical date move';
  end if;

  select protein_data_status into protein_status
  from public.daily_nutrition_summary
  where user_id = fixture_user_id and log_date = date '2026-09-25'
    and total_protein_g is null;
  if protein_status is distinct from 'incomplete' then
    raise exception 'missing protein was not preserved as incomplete/null';
  end if;

  perform public.delete_food_log_canonical_v1(legacy_id);

  if exists (select 1 from public.user_food_logs where id = canonical_id)
     or exists (select 1 from public.food_logs where id = legacy_id)
     or exists (
       select 1 from public.daily_nutrition_summary
       where user_id = fixture_user_id and log_date = date '2026-09-25'
     ) then
    raise exception 'canonical nutrition delete did not reconcile every projection';
  end if;
end;
$test$;

rollback;
