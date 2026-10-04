-- Contract: time-based and distance + time set recording (migration 20261004000700).
-- rollback-only. Needs supabase/migrations applied.

begin;

do $test$
declare
  u uuid := gen_random_uuid();
  m4 uuid; r4 uuid; e4 uuid; c4 uuid;
  rx uuid; s jsonb; sid uuid;
  ex record; sp record;
  n integer;
  logs jsonb;
begin
  insert into auth.users (id, email) values (u, 'u@contract.test');
  select r.id, r.method_id into r4, m4 from public.method_releases r
    join public.methods m on m.id = r.method_id where m.key = 'four_split_2026' and r.status = 'active';
  if r4 is null then raise exception 'fixture failed: four-split release is missing'; end if;

  -- ===== shapes and columns =====
  if (select record_shape from public.exercises where canonical_name_zh = '杠铃卧推') <> 'weight_reps' then
    raise exception 'existing exercises must default to weight_reps';
  end if;
  begin
    update public.exercises set record_shape = 'swimming' where canonical_name_zh = '卷腹';
    raise exception 'an unknown record shape was accepted';
  exception when check_violation then null;
  end;

  -- ===== privileges =====
  if has_function_privilege('anon', 'public.save_method_set_actual_v2(uuid,uuid,integer,numeric,integer,numeric,integer,numeric)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_method_set_actual_v2(uuid,uuid,integer,numeric,integer,numeric,integer,numeric)', 'execute') then
    raise exception 'save_method_set_actual_v2 privileges are wrong';
  end if;

  -- ===== fixtures: a plank-like exercise, a cardio-like exercise, targets on the templates =====
  update public.exercises set record_shape = 'duration' where canonical_name_zh = '卷腹';
  update public.exercises set record_shape = 'distance_duration' where canonical_name_zh = '悬垂举腿';
  update public.method_runtime_set_templates t set target_duration_seconds = 60, target_reps_min = null, target_reps_max = null
   from public.method_rules r where r.id = t.method_rule_id and r.method_release_id = r4 and r.rule_key = 'FS-CORE-01';
  update public.method_runtime_set_templates t set target_duration_seconds = 1800, target_distance_m = 5000, target_reps_min = null, target_reps_max = null
   from public.method_rules r where r.id = t.method_rule_id and r.method_release_id = r4 and r.rule_key = 'FS-CORE-02';

  insert into public.method_enrollments (user_id, method_id, method_release_id, status, current_cycle_number, next_split_key, current_state)
    values (u, m4, r4, 'active', 1, 'chest', 'ready') returning id into e4;
  insert into public.method_cycles (enrollment_id, cycle_number, status) values (e4, 1, 'in_progress') returning id into c4;
  perform set_config('request.jwt.claim.sub', u::text, true);
  rx := public.create_program_day_prescription(c4, 'core');

  -- targets are copied into the prescription
  select count(*) into n from public.set_prescriptions setp join public.exercise_prescriptions ep on ep.id = setp.exercise_prescription_id
   join public.exercises e on e.id = ep.exercise_id
   where ep.session_prescription_id = rx and e.canonical_name_zh = '卷腹' and setp.target_duration_seconds = 60;
  if n <> 3 then raise exception 'duration targets were not copied (% of 3 sets)', n; end if;
  select count(*) into n from public.set_prescriptions setp join public.exercise_prescriptions ep on ep.id = setp.exercise_prescription_id
   join public.exercises e on e.id = ep.exercise_id
   where ep.session_prescription_id = rx and e.canonical_name_zh = '悬垂举腿' and setp.target_duration_seconds = 1800 and setp.target_distance_m = 5000;
  if n <> 3 then raise exception 'distance targets were not copied (% of 3 sets)', n; end if;

  s := public.start_method_session_v2(rx, current_date, 'UTC', gen_random_uuid(), 60::smallint, 'user_override');
  sid := (s->>'session_id')::uuid;

  -- ===== validation by shape =====
  select id into ex from public.exercise_executions
   where workout_session_id = sid and exercise_id = (select id from public.exercises where canonical_name_zh = '卷腹');
  begin
    perform public.save_method_set_actual_v2(sid, ex.id, 1, null, null, null, null, null);
    raise exception 'a duration exercise accepted a set with no duration';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.save_method_set_actual_v2(sid, ex.id, 1, null, null, null, 0, null);
    raise exception 'a zero duration was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.save_method_set_actual_v2(sid, ex.id, 1, null, null, null, 45, -1);
    raise exception 'a negative distance was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.save_method_set_actual_v2(sid, ex.id, 1, null, null, null, 45, null);
  if (select actual_duration_seconds from public.set_executions where exercise_execution_id = ex.id and set_index = 1) <> 45 then
    raise exception 'the duration was not stored';
  end if;
  -- editing a set updates it, it does not add one
  perform public.save_method_set_actual_v2(sid, ex.id, 1, null, null, null, 50, null);
  select count(*) into n from public.set_executions where exercise_execution_id = ex.id and set_index = 1;
  if n <> 1 or (select actual_duration_seconds from public.set_executions where exercise_execution_id = ex.id and set_index = 1) <> 50 then
    raise exception 'editing a duration set did not update in place';
  end if;

  -- a reps exercise still needs reps
  select id into ex from public.exercise_executions
   where workout_session_id = sid and exercise_id = (select id from public.exercises where canonical_name_zh = '反向卷腹');
  begin
    perform public.save_method_set_actual_v2(sid, ex.id, 1, null, null, 2, 30, null);
    raise exception 'a reps exercise accepted a set with no reps';
  exception when sqlstate '22023' then null;
  end;

  -- the database refuses a completed set with nothing recorded
  begin
    update public.set_executions set actual_duration_seconds = null, actual_reps = null
     where workout_session_id = sid and set_index = 1 and actual_duration_seconds = 50;
    raise exception 'a completed set with no reps and no duration was accepted';
  exception when check_violation then null;
  end;

  -- ===== fill the day and complete it =====
  for ex in select ee.id, ee.exercise_prescription_id, e.record_shape from public.exercise_executions ee
             join public.exercises e on e.id = ee.exercise_id where ee.workout_session_id = sid loop
    for sp in select set_index from public.set_prescriptions where exercise_prescription_id = ex.exercise_prescription_id loop
      if ex.record_shape = 'duration' then
        perform public.save_method_set_actual_v2(sid, ex.id, sp.set_index, null, null, null, 55, null);
      elsif ex.record_shape = 'distance_duration' then
        perform public.save_method_set_actual_v2(sid, ex.id, sp.set_index, null, null, null, 1500, 4200.5);
      else
        perform public.save_method_set_actual_v2(sid, ex.id, sp.set_index, 0, 12, 2, null, null);
      end if;
    end loop;
  end loop;
  s := public.complete_method_session_v2(sid, gen_random_uuid(), null, null);
  if s->>'status' <> 'completed' then raise exception 'the day did not complete: %', s; end if;

  select exercises into logs from public.workout_logs where method_workout_session_id = sid;
  if logs is null then raise exception 'no workout log was written'; end if;
  if not exists (select 1 from jsonb_array_elements(logs) x, jsonb_array_elements(x->'sets') st
                  where x->>'name' = '卷腹' and (st->>'duration_seconds')::int in (50, 55)) then
    raise exception 'the log does not carry duration_seconds: %', logs;
  end if;
  if not exists (select 1 from jsonb_array_elements(logs) x, jsonb_array_elements(x->'sets') st
                  where x->>'name' = '悬垂举腿' and (st->>'distance_m')::numeric = 4200.5 and (st->>'duration_seconds')::int = 1500) then
    raise exception 'the log does not carry distance_m: %', logs;
  end if;
end;
$test$;

select jsonb_build_object('contract', 'set-record-shapes-v1') as set_record_shapes_contract;

rollback;
