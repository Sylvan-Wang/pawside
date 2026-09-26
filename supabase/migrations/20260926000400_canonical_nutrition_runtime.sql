-- Pawside Phase 0 hardening: one atomic, idempotent nutrition write model.
--
-- The normalized tables are canonical. `food_logs` remains a compatibility
-- projection only while the remaining legacy readers are migrated.

begin;

alter table public.user_food_logs
  add column if not exists client_request_id uuid;

create unique index if not exists user_food_logs_request_id_idx
  on public.user_food_logs(user_id, client_request_id)
  where client_request_id is not null;

comment on column public.user_food_logs.client_request_id is
  'Client-generated idempotency key for one meal save intent.';

alter table public.food_logs
  add column if not exists canonical_food_log_id uuid
    references public.user_food_logs(id) on delete cascade;

create unique index if not exists food_logs_canonical_id_idx
  on public.food_logs(canonical_food_log_id)
  where canonical_food_log_id is not null;

comment on column public.food_logs.canonical_food_log_id is
  'Compatibility bridge only. New code owns this row through user_food_logs.';

-- Unknown and zero are different facts. A day with an incomplete nutrient
-- basis must store NULL for that nutrient, not a fabricated zero.
alter table public.daily_nutrition_summary
  alter column total_energy_kcal drop not null,
  alter column total_energy_kcal drop default,
  alter column total_protein_g drop not null,
  alter column total_protein_g drop default,
  alter column total_fat_g drop not null,
  alter column total_fat_g drop default,
  alter column total_carb_g drop not null,
  alter column total_carb_g drop default;

alter table public.daily_nutrition_summary
  add column if not exists energy_data_status text not null default 'unknown'
    check (energy_data_status in ('complete', 'incomplete', 'unknown')),
  add column if not exists protein_data_status text not null default 'unknown'
    check (protein_data_status in ('complete', 'incomplete', 'unknown')),
  add column if not exists carb_data_status text not null default 'unknown'
    check (carb_data_status in ('complete', 'incomplete', 'unknown')),
  add column if not exists fat_data_status text not null default 'unknown'
    check (fat_data_status in ('complete', 'incomplete', 'unknown'));

create or replace function public.reconcile_daily_nutrition_summary_v1(
  p_user_id uuid,
  p_log_date date
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_meal_count integer;
  target_item_count integer;
  known_energy_count integer;
  known_protein_count integer;
  known_carb_count integer;
  known_fat_count integer;
  total_energy numeric;
  total_protein numeric;
  total_carb numeric;
  total_fat numeric;
begin
  if current_user_id is null or current_user_id <> p_user_id then
    raise exception 'nutrition summary ownership mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_log_date::text, 1)
  );

  select count(*)::integer
    into target_meal_count
  from public.user_food_logs
  where user_id = p_user_id
    and log_date = p_log_date;

  if target_meal_count = 0 then
    delete from public.daily_nutrition_summary
    where user_id = p_user_id and log_date = p_log_date;
    return;
  end if;

  select
    count(*)::integer,
    count(item.energy_kcal)::integer,
    count(item.protein_g)::integer,
    count(item.carb_g)::integer,
    count(item.fat_g)::integer,
    sum(item.energy_kcal),
    sum(item.protein_g),
    sum(item.carb_g),
    sum(item.fat_g)
  into
    target_item_count,
    known_energy_count,
    known_protein_count,
    known_carb_count,
    known_fat_count,
    total_energy,
    total_protein,
    total_carb,
    total_fat
  from public.user_food_log_items item
  join public.user_food_logs meal on meal.id = item.food_log_id
  where meal.user_id = p_user_id
    and meal.log_date = p_log_date
    and item.status <> 'rejected';

  insert into public.daily_nutrition_summary (
    user_id,
    log_date,
    total_energy_kcal,
    total_protein_g,
    total_carb_g,
    total_fat_g,
    meal_count,
    energy_data_status,
    protein_data_status,
    carb_data_status,
    fat_data_status,
    updated_at
  ) values (
    p_user_id,
    p_log_date,
    case when target_item_count > 0 and known_energy_count = target_item_count then total_energy else null end,
    case when target_item_count > 0 and known_protein_count = target_item_count then total_protein else null end,
    case when target_item_count > 0 and known_carb_count = target_item_count then total_carb else null end,
    case when target_item_count > 0 and known_fat_count = target_item_count then total_fat else null end,
    target_meal_count,
    case when target_item_count = 0 then 'unknown' when known_energy_count = target_item_count then 'complete' else 'incomplete' end,
    case when target_item_count = 0 then 'unknown' when known_protein_count = target_item_count then 'complete' else 'incomplete' end,
    case when target_item_count = 0 then 'unknown' when known_carb_count = target_item_count then 'complete' else 'incomplete' end,
    case when target_item_count = 0 then 'unknown' when known_fat_count = target_item_count then 'complete' else 'incomplete' end,
    now()
  )
  on conflict (user_id, log_date) do update set
    total_energy_kcal = excluded.total_energy_kcal,
    total_protein_g = excluded.total_protein_g,
    total_carb_g = excluded.total_carb_g,
    total_fat_g = excluded.total_fat_g,
    meal_count = excluded.meal_count,
    energy_data_status = excluded.energy_data_status,
    protein_data_status = excluded.protein_data_status,
    carb_data_status = excluded.carb_data_status,
    fat_data_status = excluded.fat_data_status,
    updated_at = now();
end;
$$;

create or replace function public.save_food_log_canonical_v1(
  p_request_id uuid,
  p_log_date date,
  p_meal_type text,
  p_raw_input_text text,
  p_notes text,
  p_items jsonb,
  p_legacy_foods jsonb,
  p_legacy_food_log_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_log_id uuid;
  existing_legacy_id uuid;
  created_log_id uuid;
  created_legacy_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null or p_log_date is null then
    raise exception 'request_id and log_date are required' using errcode = '22023';
  end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'invalid meal_type' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one food item is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_legacy_foods) <> 'array' then
    raise exception 'legacy foods must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where nullif(btrim(item->>'food_name_raw'), '') is null
       or coalesce((item->>'weight_g')::numeric, 0) <= 0
  ) then
    raise exception 'invalid food item' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || p_request_id::text, 0)
  );

  select id into existing_log_id
  from public.user_food_logs
  where user_id = current_user_id
    and client_request_id = p_request_id;

  if existing_log_id is not null then
    select id into existing_legacy_id
    from public.food_logs
    where user_id = current_user_id
      and canonical_food_log_id = existing_log_id;

    return jsonb_build_object(
      'food_log_id', existing_log_id,
      'legacy_food_log_id', existing_legacy_id,
      'idempotent', true
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || p_log_date::text, 1)
  );

  insert into public.user_food_logs (
    user_id,
    log_date,
    meal_type,
    input_mode,
    raw_input_text,
    notes,
    client_request_id
  ) values (
    current_user_id,
    p_log_date,
    p_meal_type,
    'manual',
    p_raw_input_text,
    p_notes,
    p_request_id
  )
  returning id into created_log_id;

  insert into public.user_food_log_items (
    food_log_id,
    food_id,
    food_name_raw,
    food_name_resolved,
    weight_g,
    quantity,
    unit,
    is_estimated,
    energy_kcal,
    protein_g,
    carb_g,
    fat_g,
    calculation_basis,
    status
  )
  select
    created_log_id,
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

  if p_legacy_food_log_id is null then
    insert into public.food_logs (
      user_id,
      date,
      meal_type,
      foods,
      notes,
      canonical_food_log_id
    ) values (
      current_user_id,
      p_log_date,
      p_meal_type,
      p_legacy_foods,
      p_notes,
      created_log_id
    ) returning id into created_legacy_id;
  else
    update public.food_logs set
      date = p_log_date,
      meal_type = p_meal_type,
      foods = p_legacy_foods,
      notes = p_notes,
      canonical_food_log_id = created_log_id,
      updated_at = now()
    where id = p_legacy_food_log_id
      and user_id = current_user_id
      and canonical_food_log_id is null
    returning id into created_legacy_id;

    if created_legacy_id is null then
      raise exception 'legacy food log cannot be promoted' using errcode = '23503';
    end if;
  end if;

  perform public.reconcile_daily_nutrition_summary_v1(current_user_id, p_log_date);

  return jsonb_build_object(
    'food_log_id', created_log_id,
    'legacy_food_log_id', created_legacy_id,
    'idempotent', false
  );
end;
$$;

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
    raise exception 'food log was updated by another request' using errcode = '40001';
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

create or replace function public.delete_food_log_canonical_v1(
  p_legacy_food_log_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  canonical_id uuid;
  target_log_date date;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select canonical_food_log_id, date
    into canonical_id, target_log_date
  from public.food_logs
  where id = p_legacy_food_log_id and user_id = current_user_id
  for update;

  if target_log_date is null then
    raise exception 'food log not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || target_log_date::text, 1)
  );

  delete from public.food_logs
  where id = p_legacy_food_log_id and user_id = current_user_id;

  if canonical_id is not null then
    delete from public.user_food_logs
    where id = canonical_id and user_id = current_user_id;
    perform public.reconcile_daily_nutrition_summary_v1(current_user_id, target_log_date);
  end if;

  return jsonb_build_object(
    'food_log_id', canonical_id,
    'legacy_food_log_id', p_legacy_food_log_id,
    'log_date', target_log_date,
    'canonical_deleted', canonical_id is not null
  );
end;
$$;

revoke all on function public.reconcile_daily_nutrition_summary_v1(uuid, date) from public, anon;
revoke all on function public.save_food_log_canonical_v1(uuid, date, text, text, text, jsonb, jsonb, uuid) from public, anon;
revoke all on function public.replace_food_log_canonical_v1(uuid, date, text, text, text, jsonb, jsonb, timestamptz) from public, anon;
revoke all on function public.delete_food_log_canonical_v1(uuid) from public, anon;

grant execute on function public.reconcile_daily_nutrition_summary_v1(uuid, date) to authenticated;
grant execute on function public.save_food_log_canonical_v1(uuid, date, text, text, text, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.replace_food_log_canonical_v1(uuid, date, text, text, text, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.delete_food_log_canonical_v1(uuid) to authenticated;

commit;
