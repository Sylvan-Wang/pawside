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

  select id into ex from public.exercises where review_status = 'reviewed' order by created_at limit 1;
  if ex is null then raise exception 'contract fixture failed: no reviewed exercise available'; end if;

  -- The insert that used to raise SQLSTATE 42703.
  step := 'canonical split exercise insert';
  insert into public.method_split_exercises (method_split_id, exercise_id, order_index, method_role)
    values (split_id, ex, 1, 'primary');

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
  'covers', jsonb_build_array('canonical split exercise insert', 'active release immutability', 'account deletion cascade')
) as active_method_content_contract;

rollback;
