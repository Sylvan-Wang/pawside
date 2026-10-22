-- Contract: coach chat foundation (migration 20261023000100). Rollback-only.
--
-- Covers: tenant isolation (RLS), draft immutability and status edges,
-- idempotent client_message_id / request_id, the `coach_chat` feature gate,
-- raw-only food logs (unknown stays NULL, never 0), v1 left unchanged, and the
-- idempotent free-workout RPC.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'coach-a@pawside.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'coach-b@pawside.test', '', now(), '{}', '{}', now(), now());

-- helper: run a statement that MUST fail with the given SQLSTATE
create function pg_temp.expect_error(stmt text, expected_state text)
returns void language plpgsql as $f$
begin
  execute stmt;
  raise exception 'expected % but statement succeeded: %', expected_state, stmt;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'expected %' then raise; end if;
  if sqlstate <> expected_state then
    raise exception 'expected % but got % (%): %', expected_state, sqlstate, sqlerrm, stmt;
  end if;
end;
$f$;
grant execute on function pg_temp.expect_error(text, text) to public;

-- 1. Feature gate: off by default, on after a per-user grant ------------------
do $test$
begin
  if not exists (select 1 from public.app_features where key = 'coach_chat' and enabled_for_all = false) then
    raise exception 'coach_chat feature must exist and be off for everyone';
  end if;
end;
$test$;

insert into public.user_features (user_id, feature_key)
values ('30000000-0000-4000-8000-00000000000a', 'coach_chat');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $test$
begin
  if not public.feature_enabled('coach_chat') then
    raise exception 'granted user should have coach_chat';
  end if;
end;
$test$;

-- 2. Conversation, message, draft as user A -----------------------------------
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

do $test$
declare
  conv uuid;
  msg uuid;
  draft uuid;
  draft2 uuid;
begin
  insert into public.coach_conversations (user_id)
  values ('30000000-0000-4000-8000-00000000000a') returning id into conv;
  insert into ids values ('conv', conv);

  insert into public.coach_messages (conversation_id, user_id, role, client_message_id, content, local_date)
  values (conv, '30000000-0000-4000-8000-00000000000a', 'user',
          '31000000-0000-4000-8000-000000000001', '午饭吃了米饭', date '2026-10-22')
  returning id into msg;

  -- a retried send with the same client_message_id must not insert twice
  perform pg_temp.expect_error(format(
    $q$insert into public.coach_messages (conversation_id, user_id, role, client_message_id, content, local_date)
       values (%L, '30000000-0000-4000-8000-00000000000a', 'user', '31000000-0000-4000-8000-000000000001', 'dup', date '2026-10-22')$q$,
    conv), '23505');

  insert into public.coach_drafts (user_id, conversation_id, message_id, kind, payload)
  values ('30000000-0000-4000-8000-00000000000a', conv, msg, 'meal', '{"items":[{"name":"米饭"}]}')
  returning id into draft;
  insert into ids values ('draft', draft);

  -- content is frozen once proposed
  perform pg_temp.expect_error(format(
    $q$update public.coach_drafts set payload = '{"items":[]}' where id = %L$q$, draft), '23514');
  perform pg_temp.expect_error(format(
    $q$update public.coach_drafts set request_id = gen_random_uuid() where id = %L$q$, draft), '23514');
  perform pg_temp.expect_error(format(
    $q$update public.coach_drafts set kind = 'weight' where id = %L$q$, draft), '23514');

  -- status edges: proposed cannot jump to saved
  perform pg_temp.expect_error(format(
    $q$update public.coach_drafts set status = 'saved' where id = %L$q$, draft), '23514');

  -- legal path
  update public.coach_drafts set status = 'committing' where id = draft;
  update public.coach_drafts set status = 'saved', result = '{"food_log_id":"x"}' where id = draft;

  -- terminal states stay terminal
  perform pg_temp.expect_error(format(
    $q$update public.coach_drafts set status = 'cancelled' where id = %L$q$, draft), '23514');
  perform pg_temp.expect_error(format(
    $q$update public.coach_drafts set result = '{"food_log_id":"y"}' where id = %L$q$, draft), '23514');

  -- a superseding draft is a new row with its own request_id
  insert into public.coach_drafts (user_id, conversation_id, kind, payload, supersedes_id)
  values ('30000000-0000-4000-8000-00000000000a', conv, 'meal', '{"items":[]}', draft)
  returning id into draft2;
  if (select request_id from public.coach_drafts where id = draft2)
     = (select request_id from public.coach_drafts where id = draft) then
    raise exception 'superseding draft must get a fresh request_id';
  end if;

  -- a failed commit that wrote nothing may go back to proposed, then retry
  update public.coach_drafts set status = 'committing' where id = draft2;
  update public.coach_drafts set status = 'proposed' where id = draft2;
  update public.coach_drafts set status = 'committing' where id = draft2;
  update public.coach_drafts set status = 'outcome_unknown' where id = draft2;
  update public.coach_drafts set status = 'committing' where id = draft2;
  update public.coach_drafts set status = 'saved', result = '{}' where id = draft2;

  -- clarification budget is 0 or 1
  perform pg_temp.expect_error(format(
    $q$insert into public.coach_drafts (user_id, conversation_id, kind, payload, clarifications_used)
       values ('30000000-0000-4000-8000-00000000000a', %L, 'meal', '{}', 2)$q$, conv), '23514');
end;
$test$;

-- 3. User B cannot see, write into, or take over A's rows ---------------------
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-00000000000b', true);

do $test$
declare
  conv uuid := (select id from ids where name = 'conv');
  draft uuid := (select id from ids where name = 'draft');
begin
  if public.feature_enabled('coach_chat') then
    raise exception 'ungranted user must not have coach_chat';
  end if;
  if exists (select 1 from public.coach_conversations)
     or exists (select 1 from public.coach_messages)
     or exists (select 1 from public.coach_drafts) then
    raise exception 'user B can read user A coach data';
  end if;

  -- B cannot post into A's conversation, even as itself
  perform pg_temp.expect_error(format(
    $q$insert into public.coach_messages (conversation_id, user_id, role, content, local_date)
       values (%L, '30000000-0000-4000-8000-00000000000b', 'user', 'hi', date '2026-10-22')$q$, conv), '42501');
  -- ... nor impersonate A
  perform pg_temp.expect_error(format(
    $q$insert into public.coach_messages (conversation_id, user_id, role, content, local_date)
       values (%L, '30000000-0000-4000-8000-00000000000a', 'user', 'hi', date '2026-10-22')$q$, conv), '42501');
  perform pg_temp.expect_error(format(
    $q$insert into public.coach_drafts (user_id, conversation_id, kind, payload)
       values ('30000000-0000-4000-8000-00000000000b', %L, 'meal', '{}')$q$, conv), '42501');

  -- updates/deletes against A's rows touch nothing
  update public.coach_drafts set status = 'cancelled' where id = draft;
  delete from public.coach_conversations where id = conv;
end;
$test$;

reset role;
do $test$
begin
  if not exists (select 1 from public.coach_conversations where id = (select id from ids where name = 'conv')) then
    raise exception 'user B deleted user A conversation';
  end if;
end;
$test$;

-- 4. Food v2: raw-only items; unknown stays NULL ------------------------------
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-00000000000a', true);
set local role authenticated;

do $test$
declare
  a uuid := '30000000-0000-4000-8000-00000000000a';
  req uuid := '32000000-0000-4000-8000-000000000001';
  res jsonb;
  retry jsonb;
  log_id uuid;
  legacy_id uuid;
  summary record;
  replaced jsonb;
  stale_ts timestamptz;
begin
  -- raw-only: no weight, no nutrition
  res := public.save_food_log_canonical_v2(
    req, date '2026-10-22', 'dinner', '晚饭吃了宫保鸡丁', null,
    jsonb_build_array(jsonb_build_object(
      'food_id', null, 'food_name_raw', '宫保鸡丁', 'food_name_resolved', null,
      'weight_g', null, 'is_estimated', false,
      'energy_kcal', null, 'protein_g', null, 'carb_g', null, 'fat_g', null,
      'calculation_basis', jsonb_build_object('basis_type', 'unknown'))),
    jsonb_build_array(jsonb_build_object('name', '宫保鸡丁', 'weight_g', null, 'calories', null)),
    'ai_assisted');
  log_id := (res->>'food_log_id')::uuid;
  legacy_id := (res->>'legacy_food_log_id')::uuid;

  if (select input_mode from public.user_food_logs where id = log_id) <> 'ai_assisted' then
    raise exception 'input_mode was not stored';
  end if;
  if (select weight_g from public.user_food_log_items where food_log_id = log_id) is not null
     or (select energy_kcal from public.user_food_log_items where food_log_id = log_id) is not null then
    raise exception 'raw-only item must store NULL, not 0';
  end if;

  select * into summary from public.daily_nutrition_summary
  where user_id = a and log_date = date '2026-10-22';
  if summary.total_energy_kcal is not null or summary.energy_data_status <> 'incomplete'
     or summary.meal_count <> 1 then
    raise exception 'raw-only meal must leave the day total unknown/incomplete, got % %',
      summary.total_energy_kcal, summary.energy_data_status;
  end if;
  if not exists (select 1 from public.food_logs where id = legacy_id and canonical_food_log_id = log_id) then
    raise exception 'raw-only meal is not visible through the legacy projection';
  end if;

  -- same request id => same record, nothing duplicated
  retry := public.save_food_log_canonical_v2(
    req, date '2026-10-22', 'dinner', 'ignored', null,
    jsonb_build_array(jsonb_build_object('food_name_raw', 'other')), '[]'::jsonb, 'ai_assisted');
  if not (retry->>'idempotent')::boolean or (retry->>'food_log_id')::uuid <> log_id then
    raise exception 'v2 save is not idempotent';
  end if;
  if (select count(*) from public.user_food_logs where user_id = a and client_request_id = req) <> 1 then
    raise exception 'v2 retry duplicated the meal';
  end if;

  -- invalid items
  perform pg_temp.expect_error($q$select public.save_food_log_canonical_v2(
    gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
    '[{"food_name_raw":"x","weight_g":0}]'::jsonb, '[]'::jsonb, 'manual')$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_food_log_canonical_v2(
    gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
    '[{"food_name_raw":"x","weight_g":null,"energy_kcal":120}]'::jsonb, '[]'::jsonb, 'manual')$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_food_log_canonical_v2(
    gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
    '[{"food_name_raw":"  "}]'::jsonb, '[]'::jsonb, 'manual')$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_food_log_canonical_v2(
    gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
    '[{"food_name_raw":"x"}]'::jsonb, '[]'::jsonb, 'bogus')$q$, '22023');

  -- v1 keeps its stricter contract
  perform pg_temp.expect_error($q$select public.save_food_log_canonical_v1(
    gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
    '[{"food_name_raw":"x"}]'::jsonb, '[]'::jsonb, null)$q$, '22023');

  -- another meal with known nutrition on the same day: day total stays unknown
  -- because one item is unknown (a partial total must not pose as the day total)
  perform public.save_food_log_canonical_v2(
    gen_random_uuid(), date '2026-10-22', 'lunch', null, null,
    jsonb_build_array(jsonb_build_object(
      'food_name_raw', '米饭', 'weight_g', 200, 'energy_kcal', 232, 'protein_g', 5.2,
      'carb_g', 51, 'fat_g', 0.6, 'calculation_basis', jsonb_build_object('basis_type', 'per_100g'))),
    jsonb_build_array(jsonb_build_object('name', '米饭', 'weight_g', 200, 'calories', 232)),
    'ai_assisted');
  select * into summary from public.daily_nutrition_summary where user_id = a and log_date = date '2026-10-22';
  if summary.total_energy_kcal is not null or summary.energy_data_status <> 'incomplete' or summary.meal_count <> 2 then
    raise exception 'mixed known/unknown day must stay incomplete';
  end if;

  -- replace (detail it later): raw-only -> known, stale version is refused
  select updated_at into stale_ts from public.user_food_logs where id = log_id;
  replaced := public.replace_food_log_canonical_v2(
    log_id, date '2026-10-22', 'dinner', null, null,
    jsonb_build_array(jsonb_build_object(
      'food_name_raw', '宫保鸡丁', 'weight_g', 150, 'energy_kcal', 270, 'protein_g', 22,
      'carb_g', 9, 'fat_g', 16, 'is_estimated', true,
      'calculation_basis', jsonb_build_object('basis_type', 'per_100g'))),
    jsonb_build_array(jsonb_build_object('name', '宫保鸡丁', 'weight_g', 150, 'calories', 270)),
    stale_ts);
  if (select count(*) from public.user_food_log_items where food_log_id = log_id) <> 1
     or (select weight_g from public.user_food_log_items where food_log_id = log_id) <> 150 then
    raise exception 'replace v2 did not upgrade the record in place';
  end if;
  if (replaced->>'updated_at') is null then
    raise exception 'replace v2 must return the new updated_at';
  end if;
  select * into summary from public.daily_nutrition_summary where user_id = a and log_date = date '2026-10-22';
  if summary.total_energy_kcal <> 502 or summary.energy_data_status <> 'complete' then
    raise exception 'upgraded day total should be 502 complete, got % %',
      summary.total_energy_kcal, summary.energy_data_status;
  end if;
  if (select count(*) from public.food_logs where canonical_food_log_id = log_id) <> 1 then
    raise exception 'replace v2 duplicated the legacy projection';
  end if;

  -- A version that is not the current one is refused. (Inside one test
  -- transaction now() never advances, so an "older" version is modelled with an
  -- explicitly different timestamp rather than the pre-update value.)
  perform pg_temp.expect_error(format(
    $q$select public.replace_food_log_canonical_v2(%L, date '2026-10-22', 'dinner', null, null,
       '[{"food_name_raw":"x"}]'::jsonb, '[]'::jsonb, %L)$q$, log_id, stale_ts - interval '1 second'), 'PT409');
  if (select count(*) from public.user_food_log_items where food_log_id = log_id) <> 1
     or (select food_name_raw from public.user_food_log_items where food_log_id = log_id) <> '宫保鸡丁' then
    raise exception 'a refused stale replace changed the record';
  end if;
end;
$test$;

-- B cannot replace A's meal
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-00000000000b', true);
do $test$
declare
  foreign_log uuid;
begin
  reset role;
  select id into foreign_log from public.user_food_logs
  where user_id = '30000000-0000-4000-8000-00000000000a' limit 1;
  set local role authenticated;
  perform pg_temp.expect_error(format(
    $q$select public.replace_food_log_canonical_v2(%L, date '2026-10-22', 'dinner', null, null,
       '[{"food_name_raw":"x"}]'::jsonb, '[]'::jsonb, null)$q$, foreign_log), 'P0002');
end;
$test$;

-- 5. Free workout: idempotent, calories optional ------------------------------
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-00000000000a', true);

do $test$
declare
  a uuid := '30000000-0000-4000-8000-00000000000a';
  req uuid := '33000000-0000-4000-8000-000000000001';
  first jsonb;
  again jsonb;
  other jsonb;
begin
  first := public.save_workout_log_v1(req, date '2026-10-22', '跑步', 20, null, null, null, 'coach_chat');
  again := public.save_workout_log_v1(req, date '2026-10-22', '跑步', 20, null, null, null, 'coach_chat');
  if (first->>'idempotent')::boolean or not (again->>'idempotent')::boolean
     or first->>'workout_log_id' <> again->>'workout_log_id' then
    raise exception 'workout retry is not idempotent';
  end if;
  if (select calories_burned_kcal from public.workout_logs where id = (first->>'workout_log_id')::uuid) is not null then
    raise exception 'calories must stay NULL when not given';
  end if;
  if (select exercises from public.workout_logs where id = (first->>'workout_log_id')::uuid) <> '[]'::jsonb then
    raise exception 'missing exercises should default to []';
  end if;

  -- two real sessions on the same day are both allowed
  other := public.save_workout_log_v1(gen_random_uuid(), date '2026-10-22', '跑步', 20, null, '[]', 180, 'coach_chat');
  if (select count(*) from public.workout_logs where user_id = a and date = date '2026-10-22') <> 2 then
    raise exception 'same-day workouts with different request ids must both be kept';
  end if;

  perform pg_temp.expect_error($q$select public.save_workout_log_v1(gen_random_uuid(), date '2026-10-22', '跑步', 0, null, null, null, 'manual')$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_workout_log_v1(gen_random_uuid(), date '2026-10-22', '跑步', 1441, null, null, null, 'manual')$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_workout_log_v1(gen_random_uuid(), date '2026-10-22', ' ', 20, null, null, null, 'manual')$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_workout_log_v1(gen_random_uuid(), date '2026-10-22', '跑步', 20, null, null, -1, 'manual')$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_workout_log_v1(gen_random_uuid(), date '2026-10-22', '跑步', 20, null, null, null, 'bogus')$q$, '22023');
end;
$test$;

-- B cannot see A's workout, and the same request id is a different record for B
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-00000000000b', true);
do $test$
declare
  res jsonb;
begin
  if exists (select 1 from public.workout_logs) then
    raise exception 'user B can read user A workouts';
  end if;
  res := public.save_workout_log_v1('33000000-0000-4000-8000-000000000001', date '2026-10-22', '跑步', 20, null, null, null, 'coach_chat');
  if (res->>'idempotent')::boolean then
    raise exception 'request ids must be scoped per user';
  end if;
end;
$test$;

rollback;
