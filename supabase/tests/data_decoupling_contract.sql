-- Contract: method data decoupling foundation. Rollback-only.
begin;

do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  m12 uuid; r12 uuid; enr uuid; enr_empty uuid; cyc uuid; presc uuid;
  ep_id uuid; ex uuid; ws uuid; ee uuid;
  draft_id uuid; ex_a uuid; ex_b uuid; ex_c uuid;
  n integer;
  w numeric;
begin
  insert into auth.users (id, email) values (u1, 'u1@contract.test'), (u2, 'u2@contract.test');

  update public.method_releases
     set status = 'active', activated_at = coalesce(activated_at, now())
   where version = '1.2' and status <> 'active';
  select m.id into m12 from public.methods m where m.key = 'ksw_tcy_three_split_2026';
  select r.id into r12 from public.method_releases r where r.method_id = m12 and r.version = '1.2';

  insert into public.method_enrollments (user_id, method_id, method_release_id, status)
    values (u1, m12, r12, 'active') returning id into enr;
  insert into public.method_cycles (enrollment_id, cycle_number) values (enr, 1) returning id into cyc;
  select p.id into presc from public.session_prescriptions p where p.cycle_id = cyc limit 1;
  select x.id, x.exercise_id into ep_id, ex
    from public.exercise_prescriptions x where x.session_prescription_id = presc order by x.order_index limit 1;
  insert into public.workout_sessions (user_id, session_prescription_id, enrollment_id, cycle_id, split_key, status, completed_at)
    values (u1, presc, enr, cyc, 'push', 'completed', now()) returning id into ws;
  insert into public.exercise_executions (user_id, workout_session_id, exercise_prescription_id, exercise_id, order_index, status)
    values (u1, ws, ep_id, ex, 1, 'completed') returning id into ee;
  insert into public.set_executions (user_id, workout_session_id, exercise_execution_id, set_index, actual_weight_kg, actual_reps, status, completed_at)
    values (u1, ws, ee, 1, 60, 10, 'completed', now());

  begin
    delete from public.method_enrollments where id = enr;
    raise exception 'M5 failed: an enrollment with training history was deleted';
  exception when sqlstate '23503' then null;
  end;
  select count(*) into n from public.workout_sessions where enrollment_id = enr;
  if n <> 1 then raise exception 'M5 failed: history changed after a blocked delete (% sessions)', n; end if;

  insert into public.method_enrollments (user_id, method_id, method_release_id, status)
    values (u2, m12, r12, 'archived') returning id into enr_empty;
  delete from public.method_enrollments where id = enr_empty;

  if has_function_privilege('authenticated', 'public.guard_enrollment_delete_with_history()', 'execute') then
    raise exception 'M5 failed: guard function is executable by authenticated';
  end if;

  insert into public.set_executions (user_id, workout_session_id, exercise_execution_id, set_index, actual_duration_seconds, status, completed_at)
    values (u1, ws, ee, 2, 45, 'completed', now());
  begin
    insert into public.set_executions (user_id, workout_session_id, exercise_execution_id, set_index, status, completed_at)
      values (u1, ws, ee, 3, 'completed', now());
    raise exception 'M3 failed: a completed set without any measure was accepted';
  exception when check_violation then null;
  end;

  select count(*) into n from public.exercises where review_status <> 'reviewed';
  if n <> 0 then raise exception 'M1 failed: % existing exercises are not reviewed', n; end if;

  insert into public.exercises (canonical_name_zh, review_status, created_by)
    values ('合约草稿动作', 'draft', u1) returning id into draft_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  select count(*) into n from public.exercises where id = draft_id;
  if n <> 1 then raise exception 'M1 failed: creator cannot see own draft'; end if;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.exercises where id = draft_id;
  if n <> 0 then raise exception 'M1 failed: another user can see the draft'; end if;
  select count(*) into n from public.exercises where review_status = 'reviewed';
  if n < 15 then raise exception 'M1 failed: reviewed exercises are not visible to everyone'; end if;
  execute 'reset role';

  insert into public.exercises (canonical_name_zh) values ('合约动作A') returning id into ex_a;
  insert into public.exercises (canonical_name_zh) values ('合约动作B') returning id into ex_b;
  insert into public.exercises (canonical_name_zh) values ('合约动作C') returning id into ex_c;
  insert into public.exercise_redirects values (ex_a, ex_b, 'contract');
  insert into public.exercise_redirects values (ex_b, ex_c, 'contract');
  if public.canonical_exercise_id(ex_a) <> ex_c then raise exception 'M1 failed: redirect chain does not resolve'; end if;
  if public.canonical_exercise_id(ex_c) <> ex_c then raise exception 'M1 failed: non-redirected exercise changed'; end if;
  begin
    insert into public.exercise_redirects values (ex_c, ex_c, 'self');
    raise exception 'M1 failed: self redirect accepted';
  exception when check_violation then null;
  end;
  if not has_function_privilege('authenticated', 'public.canonical_exercise_id(uuid)', 'execute')
     or has_function_privilege('anon', 'public.canonical_exercise_id(uuid)', 'execute') then
    raise exception 'M1 failed: canonical_exercise_id privileges are wrong';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  select count(*), max(actual_weight_kg) into n, w from public.v_user_exercise_sets where exercise_id = ex;
  if n <> 2 or w <> 60 then raise exception 'M2 failed: history view returned % rows, max weight %', n, w; end if;
  select top_weight_kg into w from public.v_user_exercise_last_top where exercise_id = ex;
  if w is distinct from 60::numeric then raise exception 'M2 failed: last-top view returned %', w; end if;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.v_user_exercise_sets;
  if n <> 0 then raise exception 'M2 failed: another user can read this history through the view'; end if;
  execute 'reset role';

  update public.workout_sessions set deleted_at = now() where id = ws;
  select count(*) into n from public.v_user_exercise_sets where workout_session_id = ws;
  if n <> 0 then raise exception 'M4 failed: soft-deleted session still in the view'; end if;
  select count(*) into n from public.set_executions where workout_session_id = ws;
  if n <> 2 then raise exception 'M4 failed: soft delete removed facts (% rows left)', n; end if;
  update public.workout_sessions set deleted_at = null where id = ws;

  delete from auth.users where id = u1;
  select count(*) into n from public.workout_sessions where user_id = u1;
  if n <> 0 then raise exception 'M5 failed: account deletion did not clean up sessions'; end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'data-decoupling-v1',
  'covers', jsonb_build_array('M5 enrollment delete guard', 'M1 exercise identity', 'M3 record shape', 'M4 soft delete', 'M2 history views')
) as data_decoupling_contract;

rollback;
