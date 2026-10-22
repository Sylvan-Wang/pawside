-- Manual food edit: a version conflict must ANSWER (409), not hang.
--
-- replace_food_log_canonical_v1 raised SQLSTATE 40001 (serialization_failure) when the record was
-- changed by someone else after the page loaded it. PostgREST treats 40001 as "retry the
-- transaction", so on the PostgREST version this was tested against (12.2.3) the request never
-- returned and the edit page stayed on its spinner. Only the error code changes, and nothing else
-- in the function: same signature, same behaviour, same message. The caller
-- (app/api/nutrition/food-log/[id]/route.ts) recognises the conflict by message and returns 409.
--
-- Independent of the coach chat: it fixes an existing page. Safe to apply before or after
-- 20261023000100_coach_chat_foundation.sql, and safe to leave out (the page then behaves as before).
-- Verified by tests/integration/food-routes.it.test.ts and supabase/tests/food_edit_conflict_contract.sql.

begin;

create or replace function public.replace_food_log_canonical_v1(
  p_food_log_id uuid,
  p_log_date date,
  p_meal_type text,
  p_raw_input_text text,
  p_notes text,
  p_items jsonb,
  p_legacy_foods jsonb,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  old_log_date date;
  current_updated_at timestamptz;
  compatibility_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_food_log_id is null or p_log_date is null then
    raise exception 'food_log_id and log_date are required' using errcode = '22023';
  end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'invalid meal_type' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one food item is required' using errcode = '22023';
  end if;

  select log_date, updated_at
    into old_log_date, current_updated_at
  from public.user_food_logs
  where id = p_food_log_id and user_id = current_user_id
  for update;

  if old_log_date is null then
    raise exception 'food log not found' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is not null and current_updated_at <> p_expected_updated_at then
    -- Was 40001. PostgREST retries a 40001 transaction instead of answering, so the edit page hung
    -- on a version conflict (observed on PostgREST 12.2.3). PT409 is returned as HTTP 409; the
    -- route recognises the conflict by this message, which is unchanged.
    raise exception 'food log was updated by another request' using errcode = 'PT409';
  end if;

  if old_log_date <= p_log_date then
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || old_log_date::text, 1));
    if old_log_date <> p_log_date then
      perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_log_date::text, 1));
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_log_date::text, 1));
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || old_log_date::text, 1));
  end if;

  update public.user_food_logs set
    log_date = p_log_date,
    meal_type = p_meal_type,
    raw_input_text = p_raw_input_text,
    notes = p_notes,
    updated_at = now()
  where id = p_food_log_id and user_id = current_user_id;

  delete from public.user_food_log_items where food_log_id = p_food_log_id;

  insert into public.user_food_log_items (
    food_log_id, food_id, food_name_raw, food_name_resolved, weight_g,
    quantity, unit, is_estimated, energy_kcal, protein_g, carb_g, fat_g,
    calculation_basis, status
  )
  select
    p_food_log_id,
    nullif(item->>'food_id', '')::integer,
    item->>'food_name_raw',
    nullif(item->>'food_name_resolved', ''),
    (item->>'weight_g')::numeric,
    nullif(item->>'quantity', '')::numeric,
    nullif(item->>'unit', ''),
    coalesce((item->>'is_estimated')::boolean, false),
    nullif(item->>'energy_kcal', '')::numeric,
    nullif(item->>'protein_g', '')::numeric,
    nullif(item->>'carb_g', '')::numeric,
    nullif(item->>'fat_g', '')::numeric,
    coalesce(item->'calculation_basis', '{}'::jsonb),
    'confirmed'
  from jsonb_array_elements(p_items) item;

  update public.food_logs set
    date = p_log_date,
    meal_type = p_meal_type,
    foods = p_legacy_foods,
    notes = p_notes,
    updated_at = now()
  where canonical_food_log_id = p_food_log_id
    and user_id = current_user_id
  returning id into compatibility_id;

  if compatibility_id is null then
    insert into public.food_logs (
      user_id, date, meal_type, foods, notes, canonical_food_log_id
    ) values (
      current_user_id, p_log_date, p_meal_type, p_legacy_foods, p_notes, p_food_log_id
    ) returning id into compatibility_id;
  end if;

  perform public.reconcile_daily_nutrition_summary_v1(current_user_id, old_log_date);
  if p_log_date <> old_log_date then
    perform public.reconcile_daily_nutrition_summary_v1(current_user_id, p_log_date);
  end if;

  return jsonb_build_object(
    'food_log_id', p_food_log_id,
    'legacy_food_log_id', compatibility_id,
    'old_log_date', old_log_date,
    'log_date', p_log_date
  );
end;
$$;

commit;
