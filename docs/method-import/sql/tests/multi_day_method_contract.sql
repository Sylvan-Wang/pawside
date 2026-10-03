-- 合约：多日方法与私有方法（对应 sql/02-draft-migrations.sql 的 M6–M13，依赖 01 草案）。
-- rollback-only：所有夹具都在事务内创建并回滚。

begin;

do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  m12 uuid; r12 uuid; enr1 uuid; cyc1 uuid;
  pm uuid; pr uuid; enr2 uuid; cyc2 uuid; presc2 uuid;
  s integer; mism integer := 0; legacy text; fresh text;
  n integer; t text;
  keys text[] := array['push', 'pull', 'legs'];
  k integer;
begin
  insert into auth.users (id, email) values (u1, 'u1@contract.test'), (u2, 'u2@contract.test');

  update public.method_releases
     set status = 'active', activated_at = coalesce(activated_at, now())
   where version = '1.2' and status <> 'active';
  select m.id into m12 from public.methods m where m.key = 'ksw_tcy_three_split_2026';
  select r.id into r12 from public.method_releases r where r.method_id = m12 and r.version = '1.2';

  -- M7：已有的 1.2 分化日默认值不改变既有行为
  select count(*) into n from public.method_splits
   where method_release_id = r12 and day_type = 'strength' and is_required and min_gap_days = 0;
  if n <> 3 then raise exception 'M7 failed: 1.2 splits do not keep default day settings (% of 3)', n; end if;

  -- M10：next_program_day 与现有写死的轮转逻辑在 1.2 的全部 8 种账本状态下一致
  insert into public.method_enrollments (user_id, method_id, method_release_id, status)
    values (u1, m12, r12, 'active') returning id into enr1;
  insert into public.method_cycles (enrollment_id, cycle_number) values (enr1, 1) returning id into cyc1;
  for k in 2..3 loop
    insert into public.session_prescriptions (user_id, enrollment_id, cycle_id, method_split_id, split_key, status, generated_from_rule_version)
    select u1, enr1, cyc1, ms.id, keys[k], 'ready', '1.2'
      from public.method_splits ms where ms.method_release_id = r12 and ms.key = keys[k];
  end loop;
  for s in 0..7 loop
    update public.session_prescriptions
       set status = case when ((s >> (case split_key when 'push' then 0 when 'pull' then 1 else 2 end)) & 1) = 1
                         then 'completed' else 'ready' end
     where cycle_id = cyc1;
    select c.split_key into legacy
      from (values ('push', 1), ('pull', 2), ('legs', 3)) as c(split_key, ord)
     where not exists (select 1 from public.session_prescriptions p
                        where p.cycle_id = cyc1 and p.split_key = c.split_key and p.status = 'completed')
     order by c.ord limit 1;
    fresh := public.next_program_day(cyc1);
    if legacy is distinct from fresh then
      mism := mism + 1;
    end if;
  end loop;
  if mism <> 0 then raise exception 'M10 failed: next_program_day differs from the legacy rotation in % of 8 states', mism; end if;

  -- M7：用户跳过某一天（skipped）被视为已解决
  update public.session_prescriptions set status = 'ready' where cycle_id = cyc1;
  update public.session_prescriptions set status = 'completed' where cycle_id = cyc1 and split_key = 'push';
  update public.session_prescriptions set status = 'skipped' where cycle_id = cyc1 and split_key = 'pull';
  if public.next_program_day(cyc1) is distinct from 'legs' then
    raise exception 'M7 failed: a skipped day is not treated as resolved';
  end if;

  -- M10：日志类型函数与现有 CASE 一致
  foreach t in array keys loop
    if public.workout_log_type_for_split(enr1, t)
       is distinct from (case t when 'push' then '推' when 'pull' then '拉' else '腿' end) then
      raise exception 'M10 failed: log type for % differs from the legacy CASE', t;
    end if;
  end loop;

  -- M10：内部辅助函数不对登录用户开放（Supabase 默认会授予，必须显式撤销）
  if has_function_privilege('authenticated', 'public.next_program_day(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.workout_log_type_for_split(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.next_program_day(uuid)', 'execute') then
    raise exception 'M10 failed: internal helper functions are executable by client roles';
  end if;

  -- M11/M6/M7：创建私有方法——必须先写内容（release 为 validated），最后再激活
  insert into public.methods (key, name, version, status, description, source_type, owner_user_id)
    values ('u_contract_' || left(u2::text, 8), '合约私有方法', '1.0', 'active', 't', 'imported', u2)
    returning id into pm;
  insert into public.method_releases (method_id, version, status, release_channel, release_policy,
                                      runtime_gate_status, strict_gate_status, validated_at)
    values (pm, '1.0', 'validated', 'internal_beta', 'v1_runtime', 'passed', 'pending', now())
    returning id into pr;
  insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index, day_type, is_required, min_gap_days)
    values (pm, pr, 'chest', '胸', 1, 'strength', true, 1),
           (pm, pr, 'cardio', '有氧', 2, 'cardio', false, 2);
  begin
    insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index)
      values (pm, pr, 'Bad Key', 'x', 3);
    raise exception 'M6 failed: an invalid split key was accepted';
  exception when check_violation then null;
  end;
  update public.method_releases set status = 'active', activated_at = now() where id = pr;

  -- 激活后不可再写入内容
  begin
    insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index)
      values (pm, pr, 'back', '背', 3);
    raise exception 'M11 failed: content was written into an active release';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  -- M9：可信度标签扩展
  begin
    insert into public.method_rules (method_id, method_release_id, rule_key, rule_type, version, config_json, status, source_authority)
      values (pm, pr, 'RX-CONTRACT-1', 'prescription', '1.0', '{}'::jsonb, 'active', 'library_default');
    raise exception 'M9 probe: active release is immutable, expected to be blocked before the check';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  begin
    insert into public.method_rules (method_id, method_release_id, rule_key, rule_type, version, config_json, status, source_authority)
      values (m12, r12, 'RX-CONTRACT-BOGUS', 'prescription', '1.0', '{}'::jsonb, 'active', 'bogus_authority');
    raise exception 'M9 failed: an unknown source_authority was accepted';
  exception when check_violation then null;
        when raise_exception then
    if sqlerrm like 'M9 failed%' then raise; end if;
  end;

  -- M11：可见性（行级安全）
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.methods where id = pm;
  if n <> 1 then raise exception 'M11 failed: owner cannot see the private method'; end if;
  select count(*) into n from public.method_releases where id = pr;
  if n <> 1 then raise exception 'M11 failed: owner cannot see the private release'; end if;
  select count(*) into n from public.method_splits where method_release_id = pr;
  if n <> 2 then raise exception 'M11 failed: owner sees % of 2 splits', n; end if;
  perform set_config('request.jwt.claim.sub', u1::text, true);
  select count(*) into n from public.methods where id = pm;
  if n <> 0 then raise exception 'M11 failed: another user can see the private method'; end if;
  select count(*) into n from public.method_releases where id = pr;
  if n <> 0 then raise exception 'M11 failed: another user can see the private release'; end if;
  select count(*) into n from public.method_splits where method_release_id = pr;
  if n <> 0 then raise exception 'M11 failed: another user can see the private splits'; end if;
  select count(*) into n from public.method_releases where id = r12;
  if n <> 1 then raise exception 'M11 failed: the shared official release is not visible'; end if;
  if not public.method_visible_to_user(m12) or public.method_visible_to_user(pm) then
    raise exception 'M11 failed: method_visible_to_user gives the wrong answer for user 1';
  end if;
  execute 'reset role';

  -- 私有方法的报名与"可选日不阻塞一轮"
  insert into public.method_enrollments (user_id, method_id, method_release_id, status, next_split_key)
    values (u2, pm, pr, 'active', 'chest') returning id into enr2;
  insert into public.method_cycles (enrollment_id, cycle_number) values (enr2, 1) returning id into cyc2;
  select p.id into presc2 from public.session_prescriptions p where p.cycle_id = cyc2 and p.split_key = 'chest';
  if presc2 is null then raise exception 'M6 failed: no prescription was generated for the new split key'; end if;
  if public.next_program_day(cyc2) is distinct from 'chest' then raise exception 'M10 failed: first day of the private method is not chest'; end if;
  update public.session_prescriptions set status = 'completed' where id = presc2;
  if public.next_program_day(cyc2) is not null then
    raise exception 'M7 failed: an optional cardio day blocks the end of a cycle';
  end if;
  if public.workout_log_type_for_split(enr2, 'chest') is distinct from '胸' then
    raise exception 'M10 failed: log type for the private chest day is not 胸';
  end if;

  -- M12：个人调整层的行级安全与写权限
  insert into public.user_method_adjustments (user_id, enrollment_id, split_key, action)
    values (u2, enr2, 'chest', 'skip_day');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.user_method_adjustments;
  if n <> 1 then raise exception 'M12 failed: owner cannot read own adjustment'; end if;
  begin
    insert into public.user_method_adjustments (user_id, enrollment_id, split_key, action)
      values (u2, enr2, 'chest', 'skip_day');
    raise exception 'M12 failed: a client wrote to the adjustments table directly';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', u1::text, true);
  select count(*) into n from public.user_method_adjustments;
  if n <> 0 then raise exception 'M12 failed: another user can read adjustments'; end if;
  execute 'reset role';

  -- M13：直接删除仍被阻止
  begin
    delete from public.method_releases where id = pr;
    raise exception 'M13 failed: an active private release was deleted directly';
  exception when raise_exception then
    if sqlerrm not like '%cannot be deleted%' then raise; end if;
  end;
  begin
    delete from public.method_splits where method_release_id = pr and key = 'chest';
    raise exception 'M13 failed: a split of an active release was deleted directly';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  begin
    delete from public.method_releases where id = r12;
    raise exception 'M13 failed: the official release was deleted';
  exception when raise_exception then
    if sqlerrm not like '%cannot be deleted%' then raise; end if;
  end;

  -- M13：账号删除仍然成功，并清理私有方法、release、分化日、调整与训练记录
  insert into public.workout_sessions (user_id, session_prescription_id, enrollment_id, cycle_id, split_key, status, completed_at)
    values (u2, presc2, enr2, cyc2, 'chest', 'completed', now());
  delete from auth.users where id = u2;
  select count(*) into n from public.methods where owner_user_id = u2;
  if n <> 0 then raise exception 'M13 failed: private method survived account deletion'; end if;
  select count(*) into n from public.method_releases where method_id = pm;
  if n <> 0 then raise exception 'M13 failed: private release survived account deletion'; end if;
  select count(*) into n from public.method_splits where method_release_id = pr;
  if n <> 0 then raise exception 'M13 failed: private splits survived account deletion'; end if;
  select count(*) into n from public.workout_sessions where user_id = u2;
  if n <> 0 then raise exception 'M13 failed: sessions survived account deletion'; end if;
  select count(*) into n from public.user_method_adjustments where user_id = u2;
  if n <> 0 then raise exception 'M13 failed: adjustments survived account deletion'; end if;
  select count(*) into n from public.method_releases where id = r12;
  if n <> 1 then raise exception 'M13 failed: the official release was affected by an account deletion'; end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'multi-day-method-v1',
  'covers', jsonb_build_array('M6 split key', 'M7 day types', 'M9 authority', 'M10 rotation and log type',
                              'M11 private visibility', 'M12 adjustments', 'M13 cascade-friendly protection')
) as multi_day_method_contract;

rollback;
