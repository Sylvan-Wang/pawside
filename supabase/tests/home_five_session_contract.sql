-- Contract: 居家轻力量 (home five-session) methods + equipment requirement + starting a
-- method with no current one. rollback-only. Needs supabase/migrations applied
-- (incl. 20261022000100 and 20261022000200).

begin;

do $test$
declare
  u uuid := gen_random_uuid();
  u_gym uuid := gen_random_uuid();
  u_none uuid := gen_random_uuid();
  rb uuid; rd uuid; r4 uuid;
  res jsonb;
  n integer;
  rx uuid; sess jsonb; sid uuid; ex record; st record;
  seen text[] := '{}';
  day integer;
begin
  insert into auth.users (id, email) values (u, 'home@contract.test'), (u_gym, 'gym@contract.test'), (u_none, 'none@contract.test');

  select r.id into rb from public.method_releases r join public.methods m on m.id = r.method_id where m.key = 'home_bodyweight_five_2026';
  select r.id into rd from public.method_releases r join public.methods m on m.id = r.method_id where m.key = 'home_dumbbell_five_2026';
  select r.id into r4 from public.method_releases r join public.methods m on m.id = r.method_id where m.key = 'four_split_2026' and r.status = 'active';
  if rb is null or rd is null or r4 is null then raise exception 'fixture failed: releases missing'; end if;

  -- ===== equipment requirement =====
  if (select required_equipment from public.methods where key = 'home_bodyweight_five_2026') <> 'home_bodyweight' then raise exception 'bodyweight method requirement'; end if;
  if (select required_equipment from public.methods where key = 'home_dumbbell_five_2026') <> 'basic_equipment' then raise exception 'dumbbell method requirement'; end if;
  if exists (select 1 from public.methods where key in ('four_split_2026', 'ksw_tcy_three_split_2026') and required_equipment <> 'full_gym') then
    raise exception 'existing methods must keep requiring a full gym';
  end if;
  begin
    update public.methods set required_equipment = 'barbell' where key = 'home_bodyweight_five_2026';
    raise exception 'invalid required_equipment accepted';
  exception when check_violation then null;
  end;

  -- ===== seed shape: validated, not active =====
  if (select status from public.method_releases where id = rb) not in ('validated', 'active') then raise exception 'bodyweight release status'; end if;
  select count(*) into n from public.method_splits where method_release_id = rb;
  if n <> 5 then raise exception 'bodyweight splits expected 5, got %', n; end if;
  select count(*) into n from public.method_splits where method_release_id = rd and is_required;
  if n <> 5 then raise exception 'dumbbell required splits expected 5, got %', n; end if;
  if (select day_type from public.method_splits where method_release_id = rb and key = 'comfort_cardio') <> 'cardio' then raise exception 'cardio day type'; end if;
  select count(*) into n from public.method_runtime_set_templates where method_release_id = rb;
  if n <> 22 then raise exception 'bodyweight set templates expected 22, got %', n; end if;
  select count(*) into n from public.method_runtime_set_templates t where t.method_release_id = rb and t.target_duration_seconds = 900;
  if n <> 1 then raise exception 'cardio template expected one 900s set, got %', n; end if;
  if exists (
    select 1 from public.method_split_exercises se join public.method_splits s on s.id = se.method_split_id
    join public.method_rules r on r.method_release_id = s.method_release_id and r.rule_key = se.prescription_rule_key
    where s.method_release_id in (rb, rd) and r.source_authority <> 'product_execution_default'
  ) then raise exception 'every home prescription must be labelled product_execution_default'; end if;
  if exists (
    select 1 from public.method_split_exercises se join public.method_splits s on s.id = se.method_split_id
    where s.method_release_id in (rb, rd)
      and not exists (select 1 from public.method_runtime_set_templates t join public.method_rules r on r.id = t.method_rule_id
                      where r.rule_key = se.prescription_rule_key and r.method_release_id = s.method_release_id)
  ) then raise exception 'a home exercise has no set template'; end if;

  -- Releases are activated here, inside the rolled-back transaction only.
  update public.method_releases set status = 'active' where id in (rb, rd) and status = 'validated';

  -- ===== a home user with no current method starts one =====
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform public.complete_phase2_onboarding('maintain', 'female', 165, 60, 'kg', 'new_to_structured', 'not_yet', 'home_bodyweight', 30, false);
  res := public.switch_method_release_v1(rb, null);
  if res->>'status' <> 'switched' or res->>'next_split_key' <> 'glute_leg_base' then raise exception 'home start failed: %', res; end if;
  if res->>'previous_enrollment_id' is not null then raise exception 'unexpected previous enrollment: %', res; end if;
  res := public.switch_method_release_v1(rb, null);
  if res->>'status' <> 'unchanged' then raise exception 'second switch to the same method must be unchanged: %', res; end if;

  -- ===== a full five-day rotation, then back to day 1 =====
  for day in 1..6 loop
    select sp1.id into rx from public.session_prescriptions sp1
     join public.method_enrollments e on e.id = sp1.enrollment_id
     where e.user_id = u and e.status = 'active' and sp1.split_key = e.next_split_key and sp1.status in ('ready', 'upcoming')
     order by sp1.generated_at desc limit 1;
    if rx is null then raise exception 'day %: no ready prescription', day; end if;
    sess := public.start_method_session_v3(rx, current_date, 'UTC', gen_random_uuid(), 30::smallint, 'user_override');
    sid := (sess->>'session_id')::uuid;
    for ex in select ee.id, e.record_shape from public.exercise_executions ee join public.exercises e on e.id = ee.exercise_id
              where ee.workout_session_id = sid loop
      for st in select set_index from public.set_executions where exercise_execution_id = ex.id loop
        if ex.record_shape = 'duration' then
          perform public.save_method_set_actual_v2(sid, ex.id, st.set_index, null, null, null, 900, null);
        elsif ex.record_shape = 'weight_reps' then
          perform public.save_method_set_actual_v2(sid, ex.id, st.set_index, 5, 10, 2);
        else
          perform public.save_method_set_actual_v2(sid, ex.id, st.set_index, null, 10, 2);
        end if;
      end loop;
    end loop;
    res := public.complete_method_session_v2(sid, gen_random_uuid(), null, null);
    seen := seen || (res->>'next_split_key');
  end loop;
  if seen <> array['upper_base', 'comfort_cardio', 'glute_leg_extra', 'upper_core', 'glute_leg_base', 'upper_base'] then
    raise exception 'rotation order wrong: %', seen;
  end if;

  -- ===== existing methods still switch as before =====
  perform set_config('request.jwt.claim.sub', u_gym::text, true);
  perform public.complete_phase2_onboarding('maintain', 'male', 175, 70, 'kg', 'some_experience', 'six_to_fifteen', 'full_gym', 60, false);
  res := public.switch_method_release_v1(r4, 'back');
  if res->>'next_split_key' <> 'back' then raise exception 'four-split start day: %', res; end if;
  res := public.switch_method_release_v1(rd, null);
  if res->>'status' <> 'switched' then raise exception 'switch to home dumbbell: %', res; end if;

  -- ===== no onboarding profile: refuse with a clear error =====
  perform set_config('request.jwt.claim.sub', u_none::text, true);
  begin
    perform public.switch_method_release_v1(rb, null);
    raise exception 'a user without a capability profile must not start a method';
  exception when sqlstate '22023' then null;
  end;
end;
$test$;

rollback;
