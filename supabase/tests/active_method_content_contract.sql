-- Contract: canonical Method content guard.
--
-- Regression for `protect_active_method_content()`: it is attached to
-- `method_split_exercises`, which has no `method_id` column, so reading
-- `old.method_id` aborted every canonical exercise insert with
-- `record "old" has no field "method_id"`. That broke
-- `create_private_method_v1` and the whole B7 publish path: private method
-- creation is the only production writer of these rows.
--
-- The contract keeps both halves honest: canonical rows inside an ACTIVE release
-- stay immutable, and the account-deletion cascade (the only supported delete of
-- an owned method) still completes.
-- rollback-only: fixtures never survive this transaction.
begin;

do $test$
declare
  u1 uuid := gen_random_uuid();
  method_id uuid;
  release_id uuid;
  split_id uuid;
  rule_id uuid;
  split_exercise_id uuid;
  source_document_id uuid;
  source_chunk_id uuid;
  ex uuid;
  n integer;
  step text := 'fixture';
begin
  insert into auth.users (id, email) values (u1, 'active-content-contract@example.test');
  insert into public.methods (key, name, version, status, source_type, owner_user_id)
    values ('content_guard_' || left(u1::text, 8), '内容守卫合约', '1.0', 'active', 'imported', u1)
    returning id into method_id;
  insert into public.method_releases (
    method_id, version, status, runtime_gate_status, strict_gate_status, validated_at
  ) values (method_id, '1.0', 'validated', 'passed', 'pending', now())
    returning id into release_id;
  insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index, is_required)
    values (method_id, release_id, 'day_1', '第1日', 1, true) returning id into split_id;
  insert into public.method_rules (
    method_id, method_release_id, rule_key, rule_type, version, config_json,
    status, source_authority, runtime_status, confidence, canonical_status,
    evidence_required, config_schema_version
  ) values (
    method_id, release_id, 'RX-CONTENT-GUARD', 'prescription', '1.0', '{}'::jsonb,
    'active', 'method_explicit', 'active', 'high', 'active', true, 1
  ) returning id into rule_id;

  select id into ex from public.exercises where review_status = 'reviewed' order by created_at limit 1;
  if ex is null then raise exception 'contract fixture failed: no reviewed exercise available'; end if;

  -- The insert that used to raise SQLSTATE 42703.
  step := 'canonical split exercise insert';
  insert into public.method_split_exercises (method_split_id, exercise_id, order_index, method_role)
    values (split_id, ex, 1, 'primary') returning id into split_exercise_id;
  insert into public.method_source_documents (
    method_id, source_key, source_type, title, version, checksum_sha256, status
  ) values (
    method_id, 'content-guard', 'product_patch', 'Content guard', '1.0', repeat('a', 64), 'ingested'
  ) returning id into source_document_id;
  insert into public.method_source_chunks (
    source_document_id, method_id, chunk_key, ordinal, topic, content, content_checksum_sha256
  ) values (
    source_document_id, method_id, 'chunk-1', 1, 'prescription', '3 组', repeat('b', 64)
  ) returning id into source_chunk_id;
  insert into public.method_rule_sources (
    method_rule_id, source_chunk_id, evidence_key, field_path, relationship, confidence
  ) values (rule_id, source_chunk_id, 'E-CONTENT-GUARD', 'sets', 'explicit', 'high');
  insert into public.method_prescription_field_values (
    method_split_exercise_id, method_rule_id, field_key, value_json,
    source_authority, runtime_status, confidence, evidence_key
  ) values (
    split_exercise_id, rule_id, 'sets', '3'::jsonb,
    'method_explicit', 'active', 'high', 'E-CONTENT-GUARD'
  );
  insert into public.method_release_issues (
    method_release_id, issue_key, scope, status,
    blocks_v1_runtime_release, blocks_strict_method_release
  ) values (release_id, 'content-guard', 'release', 'resolved', false, false);

  step := 'activate release';
  update public.method_releases set status = 'active', activated_at = now() where id = release_id;

  step := 'active insert guard';
  begin
    insert into public.method_split_exercises (method_split_id, exercise_id, order_index, method_role)
      values (split_id, ex, 2, 'accessory');
    raise exception 'guard failed: canonical exercise accepted into an active release';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  step := 'active split rename guard';
  begin
    update public.method_splits set name_zh = '改名' where id = split_id;
    raise exception 'guard failed: canonical split rename accepted inside an active release';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  step := 'active split delete guard';
  begin
    delete from public.method_splits where id = split_id;
    raise exception 'guard failed: canonical split deleted from an active release';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  step := 'active rule source guard';
  begin
    update public.method_rule_sources set confidence = 'low' where method_rule_id = rule_id;
    raise exception 'guard failed: rule source changed inside an active release';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  step := 'active prescription field guard';
  begin
    update public.method_prescription_field_values set value_json = '4'::jsonb
    where method_split_exercise_id = split_exercise_id;
    raise exception 'guard failed: prescription field changed inside an active release';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  step := 'active release issue guard';
  begin
    update public.method_release_issues set source_note = 'changed' where method_release_id = release_id;
    raise exception 'guard failed: release issue changed inside an active release';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  step := 'guard must have kept the fixture';
  select count(*) into n from public.method_splits where id = split_id;
  if n <> 1 then raise exception 'guard failed: the fixture split is gone after a refused delete'; end if;

  -- Account deletion is the supported way to drop an owned method, and it must
  -- cascade through the protected rows rather than being refused.
  step := 'account delete';
  begin
    delete from auth.users where id = u1;
  exception when others then
    raise exception 'cascade failed at "%": %', step, sqlerrm;
  end;

  step := 'method gone';
  select count(*) into n from public.methods where id = method_id;
  if n <> 0 then raise exception 'cascade failed: account deletion left the method behind'; end if;
  step := 'release gone';
  select count(*) into n from public.method_releases where id = release_id;
  if n <> 0 then raise exception 'cascade failed: release survived account deletion'; end if;
  step := 'split gone';
  select count(*) into n from public.method_splits where id = split_id;
  if n <> 0 then raise exception 'cascade failed: split survived account deletion'; end if;
  step := 'split exercises gone';
  select count(*) into n from public.method_split_exercises where method_split_id = split_id;
  if n <> 0 then raise exception 'cascade failed: split exercises survived account deletion'; end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'active-method-content-v1',
  'covers', jsonb_build_array('all six canonical content tables', 'active release immutability', 'account deletion cascade')
) as active_method_content_contract;

rollback;
