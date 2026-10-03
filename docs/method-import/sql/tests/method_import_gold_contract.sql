-- 合约：导入记录、动作对齐、金标表（对应 sql/03-draft-migrations.sql 的 M14–M17，依赖 01、02 草案）。
-- rollback-only。

begin;

do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  m12 uuid;
  bench uuid; d1 uuid; d2 uuid; got uuid;
  n integer; nm text; ex uuid;
begin
  insert into auth.users (id, email) values (u1, 'u1@contract.test'), (u2, 'u2@contract.test');
  select m.id into m12 from public.methods m where m.key = 'ksw_tcy_three_split_2026';
  select e.id into bench from public.exercises e where e.canonical_name_zh = '杠铃卧推';
  if bench is null then raise exception 'fixture failed: 杠铃卧推 is missing from the seed'; end if;
  update public.exercises set aliases = array['平板卧推'] where id = bench;

  -- M16：权限
  if not has_function_privilege('authenticated', 'public.resolve_or_create_exercise(text)', 'execute')
     or has_function_privilege('anon', 'public.resolve_or_create_exercise(text)', 'execute') then
    raise exception 'M16 failed: resolve_or_create_exercise privileges are wrong';
  end if;

  -- M16：必须登录
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.resolve_or_create_exercise('杠铃卧推');
    raise exception 'M16 failed: an unauthenticated call was accepted';
  exception when sqlstate '28000' then null;
  end;

  -- M16：精确名称、别名（含空格）命中已审核动作
  perform set_config('request.jwt.claim.sub', u1::text, true);
  if public.resolve_or_create_exercise('杠铃卧推') <> bench then raise exception 'M16 failed: exact name did not hit the reviewed exercise'; end if;
  if public.resolve_or_create_exercise('平板 卧推') <> bench then raise exception 'M16 failed: alias with a space did not hit the reviewed exercise'; end if;
  if public.resolve_or_create_exercise(' 杠铃-卧推 ') <> bench then raise exception 'M16 failed: punctuation was not normalised'; end if;

  -- M16：新名称创建本人草稿；同一用户重复调用返回同一条
  d1 := public.resolve_or_create_exercise('哑铃肩推');
  if public.resolve_or_create_exercise('哑铃肩推') <> d1 then raise exception 'M16 failed: same user got a second draft'; end if;
  if not exists (select 1 from public.exercises where id = d1 and review_status = 'draft' and created_by = u1) then
    raise exception 'M16 failed: draft metadata is wrong';
  end if;

  -- M16：他人的同名草稿不被复用，创建带后缀的新草稿
  perform set_config('request.jwt.claim.sub', u2::text, true);
  d2 := public.resolve_or_create_exercise('哑铃肩推');
  if d2 = d1 then raise exception 'M16 failed: another user reused a foreign draft'; end if;
  select canonical_name_zh into nm from public.exercises where id = d2;
  if nm !~ '^哑铃肩推 · [0-9a-f]{4}$' then raise exception 'M16 failed: suffixed name is %', nm; end if;

  -- M16：草稿只有创建者可见
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  select count(*) into n from public.exercises where canonical_name_zh like '哑铃肩推%';
  if n <> 1 then raise exception 'M16 failed: user 1 sees % drafts of the same name', n; end if;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.exercises where canonical_name_zh like '哑铃肩推%';
  if n <> 1 then raise exception 'M16 failed: user 2 sees % drafts of the same name', n; end if;
  execute 'reset role';

  -- M16：名称校验
  perform set_config('request.jwt.claim.sub', u1::text, true);
  begin perform public.resolve_or_create_exercise('   '); raise exception 'M16 failed: blank name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.resolve_or_create_exercise(repeat('长', 41)); raise exception 'M16 failed: 41-character name accepted';
  exception when sqlstate '22023' then null; end;

  -- M16：每人最多 100 个草稿（前面已创建 1 个，再创建 99 个凑满 100，第 101 个被拒绝）
  for n in 1..99 loop
    perform public.resolve_or_create_exercise('合约草稿' || n);
  end loop;
  begin
    perform public.resolve_or_create_exercise('合约草稿超限');
    raise exception 'M16 failed: more than 100 drafts were allowed';
  exception when sqlstate '54000' then null;
  end;

  -- M15：没有同意就无法创建导入
  begin
    insert into public.user_method_imports (user_id, text_checksum_sha256) values (u1, repeat('a', 64));
    raise exception 'M15 failed: an import without consent was accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.user_method_imports (user_id, text_checksum_sha256, consent_version, consented_at)
      values (u1, 'not-a-hash', 'health-v1', now());
    raise exception 'M15 failed: a malformed checksum was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.user_method_imports (user_id, text_checksum_sha256, consent_version, consented_at, raw_text)
      values (u1, repeat('a', 64), 'health-v1', now(), repeat('字', 30001));
    raise exception 'M15 failed: an over-length text was accepted';
  exception when check_violation then null;
  end;

  -- M15：客户端不能直接执行触发器函数
  if has_function_privilege('authenticated', 'public.enforce_import_quota()', 'execute') then
    raise exception 'M15 failed: quota trigger function is executable by authenticated';
  end if;

  -- M15：客户端不能创建"已发布"的导入（此时配额为 0，所以拒绝来自行级安全而不是配额）
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  begin
    insert into public.user_method_imports (user_id, status, text_checksum_sha256, consent_version, consented_at)
      values (u1, 'published', repeat('e', 64), 'health-v1', now());
    raise exception 'M15 failed: a client inserted an import that is already published';
  exception when insufficient_privilege then null;
  end;

  -- M15：配额（同一用户 24 小时内最多 5 条）
  insert into public.user_method_imports (user_id, text_checksum_sha256, consent_version, consented_at, raw_text)
    select u1, repeat('b', 64), 'health-v1', now(), '示例' from generate_series(1, 5);
  begin
    insert into public.user_method_imports (user_id, text_checksum_sha256, consent_version, consented_at)
      values (u1, repeat('c', 64), 'health-v1', now());
    raise exception 'M15 failed: a sixth import within 24 hours was accepted';
  exception when sqlstate '54000' then null;
  end;

  -- M15：行级安全。他人看不到；替他人写入被拒绝，且错误信息不泄露其配额状态
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.user_method_imports;
  if n <> 0 then raise exception 'M15 failed: another user can see these imports'; end if;
  begin
    insert into public.user_method_imports (user_id, text_checksum_sha256, consent_version, consented_at)
      values (u1, repeat('d', 64), 'health-v1', now());
    raise exception 'M15 failed: a user inserted an import on behalf of another user';
  exception when insufficient_privilege then null;
           when sqlstate '54000' then raise exception 'M15 failed: the quota error leaked another user''s quota state';
  end;

  -- M15：状态流转。可以进入 review，不能改成 published
  perform set_config('request.jwt.claim.sub', u1::text, true);
  update public.user_method_imports set status = 'review';
  select count(*) into n from public.user_method_imports where status = 'review';
  if n <> 5 then raise exception 'M15 failed: moving to review was not allowed'; end if;
  begin
    update public.user_method_imports set status = 'published';
    raise exception 'M15 failed: a client set status to published';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- M14：金标表登录用户可读、不可写
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  select count(*) into n from public.exercise_defaults;
  select count(*) into n from public.exercise_substitutions;
  select count(*) into n from public.exercise_cues;
  begin
    insert into public.exercise_cues (exercise_id, kind, text_zh) values (bench, 'setup', 'x');
    raise exception 'M14 failed: a client wrote to the gold cues table';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.exercise_defaults (exercise_id, level) values (bench, 'beginner');
    raise exception 'M14 failed: a client wrote to the gold defaults table';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- M14：金标表的约束
  insert into public.exercise_defaults (exercise_id, level, sets_min, sets_max, reps_min, reps_max)
    values (bench, 'beginner', 3, 4, 8, 12);
  begin
    insert into public.exercise_defaults (exercise_id, level, sets_min, sets_max) values (bench, 'intermediate', 5, 3);
    raise exception 'M14 failed: sets_min greater than sets_max was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.exercise_defaults (exercise_id, level) values (bench, 'beginner');
    raise exception 'M14 failed: a duplicate (exercise, level) default was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.exercise_substitutions (exercise_id, substitute_exercise_id, kind) values (bench, bench, 'swap');
    raise exception 'M14 failed: an exercise was made a substitute of itself';
  exception when check_violation then null;
  end;
  begin
    update public.exercises set risk_flags = array['beginner_risk'] where id = bench;
  end;

  -- M17：来源类型 user_text
  insert into public.method_source_documents (method_id, source_key, source_type, title, version, checksum_sha256, source_uri, status, metadata_json)
    values (m12, 'contract-user-text', 'user_text', '合约用户粘贴文本', '1', repeat('f', 64), 'import://contract', 'ingested', '{}'::jsonb);
  begin
    insert into public.method_source_documents (method_id, source_key, source_type, title, version, checksum_sha256, source_uri, status, metadata_json)
      values (m12, 'contract-bogus', 'bogus_type', 'x', '1', repeat('9', 64), 'import://contract', 'ingested', '{}'::jsonb);
    raise exception 'M17 failed: an unknown source type was accepted';
  exception when check_violation then null;
  end;
end;
$test$;

select jsonb_build_object(
  'contract', 'method-import-gold-v1',
  'covers', jsonb_build_array('M14 gold tables', 'M15 imports, consent, quota', 'M16 exercise alignment', 'M17 source type')
) as method_import_gold_contract;

rollback;
