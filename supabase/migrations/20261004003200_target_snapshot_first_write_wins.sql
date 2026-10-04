-- O-24 fix: a body-metric write must not rewrite the target already recorded for
-- the effective date.
--
-- `profile_target_runtime_contract.sql` asserts that recording the day's weight
-- (64.5) and then correcting that same date (64) leaves the target provenance of
-- `2026-09-27` reading 64.5. The first definition of this function called
-- `persist_nutrition_target_snapshot_v1`, whose `on conflict (user_id,
-- effective_date) do update` rewrote the snapshot with every later write, so the
-- correction changed how the already-elapsed day is scored. The contract failed
-- on a clean database and therefore in CI (O-24).
--
-- New rule: the first target snapshot recorded for a date is the provenance of
-- record. Later body-metric writes may refine the metric itself, but they keep
-- the recorded target and return its id. `update_profile_targets_v1` remains the
-- explicit way for a user to replace a snapshot.
begin;
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

  -- A target is already on record for this date: keep it, and only refresh the
  -- metric. Corrections of a day that has been scored must not move the bar.
  select id into target_id
  from public.nutrition_targets
  where user_id = current_user_id and effective_date = p_target_effective_date;

  if target_id is null then
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
revoke all on function public.save_body_metric_with_target_v1(uuid, jsonb, date, integer, numeric, numeric, numeric, text, text, jsonb, text[]) from public, anon;
grant execute on function public.save_body_metric_with_target_v1(uuid, jsonb, date, integer, numeric, numeric, numeric, text, text, jsonb, text[]) to authenticated;
commit;
