-- Contract: unfinishable days, ending early, switching with a start day, alerts
-- (migration 20261005000100). rollback-only.

begin;

create function pg_temp.save_all(p_session uuid, p_limit integer default 1000)
returns integer
language plpgsql
as $f$
declare ex record; sp record; n integer := 0;
begin
  for ex in select ee.id, ee.exercise_prescription_id from public.exercise_executions ee where ee.workout_session_id = p_session order by ee.order_index loop
    for sp in select set_index from public.set_prescriptions where exercise_prescription_id = ex.exercise_prescription_id order by set_index loop
      exit when n >= p_limit;
      perform public.save_method_set_actual_v2(p_session, ex.id, sp.set_index, 20, 8, 2, null, null);
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$f$;

do $test$
declare
  u uuid := gen_random_uuid();
  owner uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  m3 uuid; r3 uuid; m4 uuid; r4 uuid;
  e3 uuid; c3 uuid; e4 uuid;
  rx uuid; s jsonb; sid uuid; res jsonb;
  n integer; n2 integer; t text;
  rule uuid;
begin
  insert into auth.users (id, email) values (u, 'u@contract.test'), (owner, 'o@contract.test'), (stranger, 's@contract.test');
  select r.id, r.method_id into r3, m3 from public.method_releases r join public.methods m on m.id = r.method_id
   where m.key = 'ksw_tcy_three_split_2026' and r.version = '1.2';
  select r.id, r.method_id into r4, m4 from public.method_releases r join public.methods m on m.id = r.method_id
   where m.key = 'four_split_2026' and r.status = 'active';
  update public.method_releases set status = 'active' where id = r3 and status = 'validated';

  -- ===== 1. every exercise of every active release has sets =====
  select count(*) into n from public.method_split_exercises se
    join public.method_splits s on s.id = se.method_split_id
    join public.method_releases r on r.id = s.method_release_id and r.status = 'active'
   where not exists (select 1 from public.method_runtime_set_templates t join public.method_rules ru on ru.id = t.method_rule_id
                      where ru.method_release_id = r.id and ru.rule_key = se.prescription_rule_key)
     and not exists (select 1 from public.method_prescription_field_values f where f.method_split_exercise_id = se.id and f.field_key = 'sets');
  if n <> 0 then raise exception '% exercises of active releases have no sets', n; end if;
  select count(*) into n from public.method_runtime_set_templates t join public.method_rules ru on ru.id = t.method_rule_id
   where ru.method_release_id = r3 and ru.rule_key = 'RX-DAY2-04';
  if n <> 3 then raise exception 'the open-elbow row has % sets, expected 3', n; end if;

  -- ===== a release with an exercise that has no sets cannot be activated =====
  declare bad_method uuid; bad_release uuid; bad_split uuid; ex uuid;
  begin
    insert into public.methods (key, name, version, status, source_type) values ('contract_bad', 'bad', '1', 'draft', 'imported') returning id into bad_method;
    insert into public.method_releases (method_id, version, status, release_channel, release_policy, runtime_gate_status, strict_gate_status, validated_at)
      values (bad_method, '1', 'validated', 'internal_beta', 'v1_runtime', 'passed', 'pending', now()) returning id into bad_release;
    insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index) values (bad_method, bad_release, 'day_one', '一', 1) returning id into bad_split;
    select id into ex from public.exercises where canonical_name_zh = '杠铃卧推';
    insert into public.method_rules (method_id, method_release_id, rule_key, rule_type, version, config_json, status)
      values (bad_method, bad_release, 'BAD-1', 'prescription', '1', '{}'::jsonb, 'active');
    insert into public.method_split_exercises (method_split_id, exercise_id, order_index, method_role, prescription_rule_key, progression_rule_key)
      values (bad_split, ex, 1, 'primary', 'BAD-1', 'none');
    begin
      update public.method_releases set status = 'active' where id = bad_release;
      raise exception 'a release with an exercise that has no sets was activated';
    exception when sqlstate '22023' then null;
    end;
  end;

  -- ===== 2. an exercise without sets no longer makes the day unfinishable =====
  select ru.id into rule from public.method_rules ru where ru.method_release_id = r3 and ru.rule_key = 'RX-DAY2-04';
  delete from public.method_runtime_set_templates where method_rule_id = rule;   -- recreate the old gap (test only)
  insert into public.method_enrollments (user_id, method_id, method_release_id, status, current_cycle_number, next_split_key, current_state)
    values (u, m3, r3, 'active', 1, 'pull', 'ready') returning id into e3;
  insert into public.method_cycles (enrollment_id, cycle_number, status) values (e3, 1, 'in_progress') returning id into c3;
  perform set_config('request.jwt.claim.sub', u::text, true);

  -- the gap is reported as an alert (and counted, not duplicated)
  select count(*) into n from public.system_alerts where kind = 'prescription_missing_sets';
  if n <> 1 then raise exception 'expected 1 missing-sets alert, found %', n; end if;
  perform public.report_missing_sets((select sp.id from public.session_prescriptions sp where sp.enrollment_id = e3 limit 1));
  select occurrences into n from public.system_alerts where kind = 'prescription_missing_sets';
  if n <> 2 then raise exception 'the alert was not deduplicated (occurrences %)', n; end if;
  if (select repair_prompt from public.system_alerts where kind = 'prescription_missing_sets') not like '%坐姿开肘划船%' then
    raise exception 'the repair prompt does not name the exercise';
  end if;

  select sp.id into rx from public.session_prescriptions sp where sp.enrollment_id = e3 and sp.split_key = 'pull';
  s := public.start_method_session_v2(rx, current_date, 'UTC', gen_random_uuid(), 60::smallint, 'user_override');
  sid := (s->>'session_id')::uuid;
  perform pg_temp.save_all(sid);
  res := public.complete_method_session_v2(sid, gen_random_uuid(), null, null);
  if res->>'status' <> 'completed' or (res->>'required_exercise_count')::int <> 4 then
    raise exception 'a 60-minute pull day with one set-less exercise should need 4, got %', res;
  end if;

  -- ===== 3. ending a day early =====
  insert into public.method_enrollments (user_id, method_id, method_release_id, status, current_cycle_number, next_split_key, current_state)
    select owner, m4, r4, 'active', 1, 'chest', 'ready' returning id into e4;
  insert into public.method_cycles (enrollment_id, cycle_number, status) values (e4, 1, 'in_progress');
  perform set_config('request.jwt.claim.sub', owner::text, true);
  select sp.id into rx from public.session_prescriptions sp where sp.enrollment_id = e4 and sp.split_key = 'chest';
  s := public.start_method_session_v2(rx, current_date, 'UTC', gen_random_uuid(), 60::smallint, 'user_override');
  sid := (s->>'session_id')::uuid;

  -- another user cannot end it
  perform set_config('request.jwt.claim.sub', stranger::text, true);
  begin
    perform public.end_method_session_early_v1(sid);
    raise exception 'a stranger ended someone else''s session';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('request.jwt.claim.sub', owner::text, true);

  -- nothing recorded: closed, but no history entry
  res := public.end_method_session_early_v1(sid);
  if (res->>'logged')::boolean then raise exception 'an empty day wrote a history entry'; end if;
  if exists (select 1 from public.workout_logs where method_workout_session_id = sid) then raise exception 'an empty day left a workout log'; end if;
  if (select status from public.session_prescriptions where id = rx) <> 'ready' then raise exception 'the day was not released for another try'; end if;

  -- again: two sets recorded, then ended
  s := public.start_method_session_v2(rx, current_date, 'UTC', gen_random_uuid(), 60::smallint, 'user_override');
  sid := (s->>'session_id')::uuid;
  perform pg_temp.save_all(sid, 2);
  res := public.end_method_session_early_v1(sid, null);
  if not (res->>'logged')::boolean or (res->>'completed_set_count')::int <> 2 then raise exception 'ending early did not log the 2 sets: %', res; end if;
  if (select completion_policy_version from public.workout_sessions where id = sid) <> 'ended_early_v1' then raise exception 'not marked ended early'; end if;
  if (select next_split_key from public.method_enrollments where id = e4) <> 'chest' then raise exception 'ending early moved the rotation'; end if;
  if (select status from public.session_prescriptions where id = rx) = 'completed' then raise exception 'ending early completed the day'; end if;
  select jsonb_array_length(exercises) into n from public.workout_logs where method_workout_session_id = sid;
  if n <> 1 then raise exception 'the log should list only exercises with recorded sets, found %', n; end if;
  if (select type from public.workout_logs where method_workout_session_id = sid) <> '胸' then raise exception 'wrong log type'; end if;
  -- ending twice is harmless
  res := public.end_method_session_early_v1(sid);
  if not (res->>'idempotent')::boolean then raise exception 'ending twice was not idempotent'; end if;

  -- ===== 4. switching with an open day, choosing the start day =====
  s := public.start_method_session_v2(rx, current_date, 'UTC', gen_random_uuid(), 60::smallint, 'user_override');
  sid := (s->>'session_id')::uuid;
  perform pg_temp.save_all(sid, 3);
  select count(*) into n from public.set_executions where user_id = owner;
  begin
    perform public.switch_method_release_v1(r3, 'no_such_day');
    raise exception 'an unknown start day was accepted';
  exception when sqlstate '22023' then null;
  end;
  res := public.switch_method_release_v1(r3, 'legs');
  if res->>'status' <> 'switched' or res->>'next_split_key' <> 'legs' then raise exception 'switch with a start day failed: %', res; end if;
  if (res->>'ended_open_sessions')::int <> 1 then raise exception 'the open day was not closed'; end if;
  select count(*) into n2 from public.set_executions where user_id = owner;
  if n2 <> n then raise exception 'switching lost recorded sets (% -> %)', n, n2; end if;
  if not exists (select 1 from public.workout_logs where method_workout_session_id = sid) then raise exception 'the closed day has no history entry'; end if;
  if not exists (select 1 from public.session_prescriptions sp where sp.enrollment_id = (res->>'enrollment_id')::uuid and sp.split_key = 'legs' and sp.status = 'ready') then
    raise exception 'the start day has no prescription';
  end if;

  -- ===== AI generation log: a user can write their own rows and nobody else's =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', owner::text, true);
  insert into public.ai_generations (user_id, surface, input_snapshot_id, prompt_version, model, payload, status)
    values (owner, 'daily_review', 'x', 'p', 'm', '{}'::jsonb, 'ok');
  begin
    insert into public.ai_generations (user_id, surface, input_snapshot_id, prompt_version, model, payload, status)
      values (stranger, 'daily_review', 'x', 'p', 'm', '{}'::jsonb, 'ok');
    raise exception 'a user wrote an AI log row for someone else';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- ===== 5. alerts are visible only to the owner =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', stranger::text, true);
  select count(*) into n from public.system_alerts;
  if n <> 0 then raise exception 'a stranger can read % alerts', n; end if;
  begin
    perform public.resolve_system_alert((select id from public.system_alerts limit 1));
    raise exception 'a stranger resolved an alert';
  exception when sqlstate '42501' then null;
  end;
  execute 'reset role';
  insert into public.user_features (user_id, feature_key) values (owner, 'owner_console');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', owner::text, true);
  select count(*) into n from public.system_alerts where status = 'open';
  if n < 1 then raise exception 'the owner cannot read alerts'; end if;
  perform public.resolve_system_alert((select id from public.system_alerts where status = 'open' limit 1));
  select count(*) into n2 from public.system_alerts where status = 'resolved';
  if n2 <> 1 then raise exception 'resolving did not work'; end if;
  execute 'reset role';
end;
$test$;

select jsonb_build_object('contract', 'end-early-and-alerts-v1') as end_early_and_alerts_contract;

rollback;
