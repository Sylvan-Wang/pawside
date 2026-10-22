-- Contract: replace_food_log_canonical_v1 reports a stale edit as PT409 (HTTP 409 through PostgREST),
-- still refuses a foreign record, and still edits normally. Rollback-only.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '34000000-0000-4000-8000-00000000000a',
  'authenticated', 'authenticated', 'edit-conflict@pawside.test', '', now(), '{}', '{}', now(), now());

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $test$
declare
  saved jsonb;
  log_id uuid;
  ts timestamptz;
begin
  saved := public.save_food_log_canonical_v1(
    gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
    '[{"food_name_raw":"rice","weight_g":100,"energy_kcal":100,"protein_g":1,"carb_g":20,"fat_g":0,"calculation_basis":{}}]'::jsonb,
    '[{"name":"rice","weight_g":100,"calories":100}]'::jsonb, null);
  log_id := (saved->>'food_log_id')::uuid;
  select updated_at into ts from public.user_food_logs where id = log_id;

  -- the current version edits normally
  perform public.replace_food_log_canonical_v1(
    log_id, date '2026-10-22', 'lunch', null, null,
    '[{"food_name_raw":"rice","weight_g":50,"energy_kcal":50,"protein_g":1,"carb_g":10,"fat_g":0,"calculation_basis":{}}]'::jsonb,
    '[{"name":"rice","weight_g":50,"calories":50}]'::jsonb, ts);

  -- a stale version is a conflict with a code PostgREST answers (not 40001)
  begin
    perform public.replace_food_log_canonical_v1(
      log_id, date '2026-10-22', 'lunch', null, null,
      '[{"food_name_raw":"x","weight_g":1,"energy_kcal":1,"protein_g":1,"carb_g":1,"fat_g":1,"calculation_basis":{}}]'::jsonb,
      '[]'::jsonb, ts - interval '1 second');
    raise exception 'stale edit was accepted';
  exception when others then
    if sqlstate <> 'PT409' or sqlerrm <> 'food log was updated by another request' then
      raise exception 'expected PT409 conflict, got % %', sqlstate, sqlerrm;
    end if;
  end;

  if (select weight_g from public.user_food_log_items where food_log_id = log_id) <> 50 then
    raise exception 'a refused edit changed the record';
  end if;

  -- a record that is not yours does not exist for you
  begin
    perform public.replace_food_log_canonical_v1(
      gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
      '[{"food_name_raw":"x","weight_g":1,"energy_kcal":1,"protein_g":1,"carb_g":1,"fat_g":1,"calculation_basis":{}}]'::jsonb,
      '[]'::jsonb, null);
    raise exception 'unknown record was accepted';
  exception when others then
    if sqlstate <> 'P0002' then raise exception 'expected P0002, got %', sqlstate; end if;
  end;
end;
$test$;

rollback;
