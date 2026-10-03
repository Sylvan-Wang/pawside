-- Contract: generalized runtime and default-off mutation boundaries.
-- rollback-only: fixtures never survive this transaction.
begin;

do $test$
declare
  owner_id uuid := gen_random_uuid();
  method_id uuid;
  release_id uuid;
  enrollment_id uuid;
  i integer;
begin
  insert into auth.users (id, email) values (owner_id, 'runtime-contract@example.test');
  insert into public.methods (key, name, version, status, source_type, owner_user_id)
  values ('runtime_contract_' || left(owner_id::text, 8), '十四日合约', '1.0', 'active', 'imported', owner_id)
  returning id into method_id;
  insert into public.method_releases (
    method_id, version, status, runtime_gate_status, strict_gate_status, validated_at
  ) values (method_id, '1.0', 'validated', 'passed', 'pending', now())
  returning id into release_id;

  for i in 1..14 loop
    insert into public.method_splits (
      method_id, method_release_id, key, name_zh, order_index, is_required
    ) values (method_id, release_id, 'day_' || i, '第' || i || '日', i, true);
  end loop;
  begin
    update public.method_splits set order_index = 15
    where method_release_id = release_id and order_index = 14;
    raise exception 'A2 failed: a fifteenth Program Day was accepted';
  exception when check_violation then null;
  end;

  if has_function_privilege('authenticated', 'public.create_session_prescription_for_cycle_v2(uuid,date)', 'execute') then
    raise exception 'A2 failed: internal cycle materializer is client executable';
  end if;
  if not has_function_privilege('authenticated', 'public.create_program_day_prescription_v2(uuid,text,date)', 'execute')
     or not has_function_privilege('authenticated', 'public.complete_method_session_v3(uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.enroll_in_method_release_v1(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.apply_adjustment_v1(uuid,text,uuid,text,jsonb,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.revoke_adjustment_v1(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.skip_program_day_v1(uuid)', 'execute') then
    raise exception 'A runtime failed: an authenticated entry point is missing';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  begin
    perform public.enroll_in_method_release_v1(release_id);
    raise exception 'A3 failed: enrollment succeeded while feature is disabled';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  insert into public.method_enrollments (
    user_id, method_id, method_release_id, status, next_split_key
  ) values (owner_id, method_id, release_id, 'active', 'day_1') returning id into enrollment_id;
  if enrollment_id is null then raise exception 'A3 fixture failed'; end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'method-import-runtime-v1',
  'covers', jsonb_build_array('A1-A3 entry points', 'A6 entry points', 'default-off gate', '14 Program Days')
) as method_import_runtime_contract;

rollback;
