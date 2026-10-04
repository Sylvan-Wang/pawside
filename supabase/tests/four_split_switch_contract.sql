-- Contract: four-split method release + multi-day runtime + method switching.
-- rollback-only. Needs supabase/migrations applied (incl. 20261004000200 .. 000500).

begin;

create function pg_temp.run_day(p_user uuid, p_minutes smallint default 45)
returns jsonb
language plpgsql
as $f$
declare
  rx record;
  sess jsonb;
  sid uuid;
  ex record;
  sp record;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select sp1.id into rx from public.session_prescriptions sp1
   join public.method_enrollments e on e.id = sp1.enrollment_id
   where e.user_id = p_user and e.status = 'active' and sp1.split_key = e.next_split_key
     and sp1.status in ('ready', 'upcoming', 'started')
   order by sp1.generated_at desc limit 1;
  if rx.id is null then raise exception 'run_day: no ready prescription for the next day'; end if;
  sess := public.start_method_session_v2(rx.id, current_date, 'UTC', gen_random_uuid(), p_minutes, 'user_override');
  sid := (sess->>'session_id')::uuid;
  if sid is null then sid := (sess->'session'->>'id')::uuid; end if;
  if sid is null then raise exception 'run_day: cannot read session id from %', sess; end if;
  for ex in select id, exercise_prescription_id from public.exercise_executions where workout_session_id = sid loop
    for sp in select set_index, target_reps_min from public.set_prescriptions where exercise_prescription_id = ex.exercise_prescription_id loop
      perform public.save_method_set_actual(sid, ex.id, sp.set_index, 20, coalesce(sp.target_reps_min, 8), 2);
    end loop;
  end loop;
  return public.complete_method_session_v2(sid, gen_random_uuid(), null, null);
end;
$f$;

do $test$
declare
  u uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  m12 uuid; r12 uuid; r4 uuid; m4 uuid;
  e12 uuid; c12 uuid; e4 uuid; c4 uuid;
  res jsonb;
  n integer; n2 integer;
  sessions_before integer; sets_before integer; logs_before integer;
  t text;
begin
  insert into auth.users (id, email) values (u, 'u@contract.test'), (u2, 'u2@contract.test');
  select r.id, r.method_id into r12, m12 from public.method_releases r
    join public.methods m on m.id = r.method_id
   where m.key = 'ksw_tcy_three_split_2026' and r.version = '1.2';
  select r.id, r.method_id into r4, m4 from public.method_releases r
    join public.methods m on m.id = r.method_id
   where m.key = 'four_split_2026' and r.version = '1.0';
  if r12 is null or r4 is null then raise exception 'fixture failed: releases missing (1.2 %, four-split %)', r12, r4; end if;

  -- ===== seed shape =====
  if (select status from public.method_releases where id = r4) <> 'active' then raise exception 'four-split release is not active'; end if;
  select count(*) into n from public.method_splits where method_release_id = r4;
  if n <> 5 then raise exception 'four-split has % splits, expected 5', n; end if;
  select count(*) into n from public.method_splits where method_release_id = r4 and is_required;
  if n <> 4 then raise exception 'four-split has % required days, expected 4', n; end if;
  if (select string_agg(key, ',' order by order_index) from public.method_splits where method_release_id = r4 and is_required) <> 'chest,back,legs,shoulders' then
    raise exception 'four-split day order is wrong';
  end if;
  select count(*) into n from public.method_split_exercises se join public.method_splits s on s.id = se.method_split_id where s.method_release_id = r4;
  if n <> 24 then raise exception 'four-split has % exercises, expected 24', n; end if;
  select count(*) into n from public.method_runtime_set_templates where method_release_id = r4;
  if n <> 84 then raise exception 'four-split has % set templates, expected 84', n; end if;
  -- the 1.2 release was not touched
  select count(*) into n from public.method_splits where method_release_id = r12;
  if n <> 3 then raise exception '1.2 release was changed (% splits)', n; end if;

  -- ===== privileges =====
  if has_function_privilege('anon', 'public.switch_method_release_v1(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.switch_method_release_v1(uuid)', 'execute') then
    raise exception 'switch_method_release_v1 privileges are wrong';
  end if;
  if has_function_privilege('authenticated', 'public.first_required_split_key(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.workout_log_type_for_split(uuid,text)', 'execute') then
    raise exception 'internal helpers are executable by authenticated';
  end if;

  -- ===== unauthenticated =====
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.switch_method_release_v1(r4);
    raise exception 'unauthenticated switch was accepted';
  exception when sqlstate '28000' then null;
  end;

  -- production activated 1.2 by hand; a replayed database has it as 'validated'
  update public.method_releases set status = 'active' where id = r12 and status = 'validated';

  -- ===== 1.2 behaves exactly as before: push -> pull -> legs, log types 推/拉/腿 =====
  insert into public.method_enrollments (user_id, method_id, method_release_id, status, current_cycle_number, next_split_key, current_state)
    values (u, m12, r12, 'active', 1, 'push', 'ready') returning id into e12;
  insert into public.method_cycles (enrollment_id, cycle_number, status) values (e12, 1, 'in_progress') returning id into c12;

  res := pg_temp.run_day(u);
  if (select next_split_key from public.method_enrollments where id = e12) <> 'pull' then raise exception '1.2 rotation: push did not lead to pull'; end if;
  res := pg_temp.run_day(u);
  if (select next_split_key from public.method_enrollments where id = e12) <> 'legs' then raise exception '1.2 rotation: pull did not lead to legs'; end if;
  res := pg_temp.run_day(u);
  if (res->>'cycle_completed')::boolean is distinct from true then raise exception '1.2: legs did not finish the cycle'; end if;
  select next_split_key, current_cycle_number into t, n from public.method_enrollments where id = e12;
  if t <> 'push' or n <> 2 then raise exception '1.2: after the cycle expected push / cycle 2, got % / %', t, n; end if;
  if (select string_agg(type, ',' order by created_at, type) from public.workout_logs where user_id = u) not in ('推,拉,腿', '推,腿,拉', '拉,推,腿', '拉,腿,推', '腿,推,拉', '腿,拉,推') then
    raise exception '1.2 log types are wrong: %', (select string_agg(type, ',') from public.workout_logs where user_id = u);
  end if;

  select count(*) into sessions_before from public.workout_sessions where user_id = u;
  select count(*) into sets_before from public.set_executions where user_id = u;
  select count(*) into logs_before from public.workout_logs where user_id = u;
  if sessions_before <> 3 or sets_before = 0 or logs_before <> 3 then raise exception 'fixture failed: history counts % / % / %', sessions_before, sets_before, logs_before; end if;

  -- ===== switching: errors =====
  perform set_config('request.jwt.claim.sub', u2::text, true);
  begin
    perform public.switch_method_release_v1(r4);
    raise exception 'a user with no active enrollment could switch';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform public.switch_method_release_v1(gen_random_uuid());
    raise exception 'switching to an unknown release was accepted';
  exception when sqlstate 'P0002' then null;
  end;
  res := public.switch_method_release_v1(r12);
  if res->>'status' <> 'unchanged' then raise exception 'switching to the current release was not a no-op'; end if;

  -- a session in progress blocks switching
  declare rx uuid; s jsonb;
  begin
    select sp1.id into rx from public.session_prescriptions sp1 where sp1.enrollment_id = e12 and sp1.status in ('ready','upcoming') limit 1;
    s := public.start_method_session_v2(rx, current_date, 'UTC', gen_random_uuid(), 60::smallint, 'user_override');
    begin
      perform public.switch_method_release_v1(r4);
      raise exception 'switching during a session in progress was accepted';
    exception when sqlstate '55000' then null;
    end;
    update public.workout_sessions set status = 'completed', completed_at = now() where id = (s->>'session_id')::uuid;
    if (s->>'session_id') is null then raise exception 'fixture failed: start result %', s; end if;
  end;

  -- ===== switching: success, history untouched =====
  select count(*) into sessions_before from public.workout_sessions where user_id = u;
  select count(*) into sets_before from public.set_executions where user_id = u;
  select count(*) into logs_before from public.workout_logs where user_id = u;
  res := public.switch_method_release_v1(r4);
  if res->>'status' <> 'switched' then raise exception 'switch failed: %', res; end if;
  e4 := (res->>'enrollment_id')::uuid;
  c4 := (res->>'cycle_id')::uuid;
  if res->>'next_split_key' <> 'chest' then raise exception 'first day of the four-split is %', res->>'next_split_key'; end if;
  if (select status from public.method_enrollments where id = e12) <> 'archived' then raise exception 'old enrollment was not archived'; end if;
  if (select count(*) from public.method_enrollments where user_id = u and status = 'active') <> 1 then raise exception 'user does not have exactly one active enrollment'; end if;
  select count(*) into n from public.workout_sessions where user_id = u;
  select count(*) into n2 from public.set_executions where user_id = u;
  if n <> sessions_before or n2 <> sets_before or (select count(*) from public.workout_logs where user_id = u) <> logs_before then
    raise exception 'switching changed the training history';
  end if;
  select count(*) into n from public.session_prescriptions sp join public.exercise_prescriptions ep on ep.session_prescription_id = sp.id
   where sp.enrollment_id = e4 and sp.split_key = 'chest' and sp.status = 'ready';
  if n <> 6 then raise exception 'the chest prescription has % exercises, expected 6', n; end if;
  select count(*) into n from public.set_prescriptions setp join public.exercise_prescriptions ep on ep.id = setp.exercise_prescription_id
   join public.session_prescriptions sp on sp.id = ep.session_prescription_id where sp.enrollment_id = e4 and sp.split_key = 'chest';
  if n <> 22 then raise exception 'the chest prescription has % sets, expected 22', n; end if;

  -- ===== four-split rotation: chest -> back -> legs -> shoulders -> cycle 2, optional core day =====
  res := pg_temp.run_day(u);
  if (select next_split_key from public.method_enrollments where id = e4) <> 'back' then raise exception 'four-split: chest did not lead to back'; end if;
  res := pg_temp.run_day(u);
  if (select next_split_key from public.method_enrollments where id = e4) <> 'legs' then raise exception 'four-split: back did not lead to legs'; end if;

  -- an optional core day can be done at any time and does not move the rotation
  perform public.create_program_day_prescription(c4, 'core');
  declare rx uuid; s jsonb; ex record; sp record;
  begin
    select sp1.id into rx from public.session_prescriptions sp1 where sp1.enrollment_id = e4 and sp1.split_key = 'core';
    s := public.start_method_session_v2(rx, current_date, 'UTC', gen_random_uuid(), 60::smallint, 'user_override');
    for ex in select id, exercise_prescription_id from public.exercise_executions where workout_session_id = (s->>'session_id')::uuid loop
      for sp in select set_index, target_reps_min from public.set_prescriptions where exercise_prescription_id = ex.exercise_prescription_id loop
        perform public.save_method_set_actual((s->>'session_id')::uuid, ex.id, sp.set_index, 0, coalesce(sp.target_reps_min, 10), 2);
      end loop;
    end loop;
    res := public.complete_method_session_v2((s->>'session_id')::uuid, gen_random_uuid(), null, null);
  end;
  if (select next_split_key from public.method_enrollments where id = e4) <> 'legs' then raise exception 'the optional core day moved the rotation'; end if;
  if (res->>'cycle_completed')::boolean is distinct from false then raise exception 'the core day finished the cycle'; end if;

  res := pg_temp.run_day(u);
  if (select next_split_key from public.method_enrollments where id = e4) <> 'shoulders' then raise exception 'four-split: legs did not lead to shoulders'; end if;
  res := pg_temp.run_day(u);
  if (res->>'cycle_completed')::boolean is distinct from true then raise exception 'four-split: shoulders did not finish the cycle'; end if;
  select next_split_key, current_cycle_number into t, n from public.method_enrollments where id = e4;
  if t <> 'chest' or n <> 2 then raise exception 'four-split: after the cycle expected chest / cycle 2, got % / %', t, n; end if;
  if (select string_agg(type, ',' order by type) from public.workout_logs where user_id = u and method_workout_session_id in (select id from public.workout_sessions where enrollment_id = e4))
     <> (select string_agg(x, ',' order by x) from unnest(array['胸','背','腿','肩','腹肌']) x) then
    raise exception 'four-split log types are wrong: %', (select string_agg(type, ',') from public.workout_logs where user_id = u);
  end if;
  if exists (select 1 from public.workout_logs where user_id = u and type = '腿' and method_workout_session_id in (select id from public.workout_sessions where enrollment_id = e4 and split_key <> 'legs')) then
    raise exception 'a non-leg day was logged as 腿';
  end if;

  -- ===== switching back works; history of both methods stays =====
  res := public.switch_method_release_v1(r12);
  if res->>'status' <> 'switched' or res->>'next_split_key' <> 'push' then raise exception 'switching back failed: %', res; end if;
  select count(*) into n from public.workout_sessions where user_id = u;
  if n <> sessions_before + 5 then raise exception 'history after switching back has % sessions, expected %', n, sessions_before + 5; end if;
end;
$test$;

select jsonb_build_object('contract', 'four-split-switch-v1') as four_split_switch_contract;

rollback;
