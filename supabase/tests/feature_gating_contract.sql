-- Contract: feature gating (migration 20261004000100_feature_gating). rollback-only.

begin;

do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  n integer;
begin
  insert into auth.users (id, email) values (u1, 'u1@contract.test'), (u2, 'u2@contract.test');

  -- ===== 05：灰度开关 =====
  select count(*) into n from public.app_features
   where key in ('multi_day_runtime', 'method_import', 'adjustments', 'review_hub') and not enabled_for_all;
  if n <> 4 then raise exception 'feature gating failed: the four feature keys are not seeded as off (% of 4)', n; end if;

  if has_function_privilege('anon', 'public.feature_enabled(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.feature_enabled(text)', 'execute') then
    raise exception 'feature gating failed: feature_enabled privileges are wrong';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  if public.feature_enabled('method_import') then raise exception 'feature gating failed: a feature is on by default'; end if;
  if public.feature_enabled('no_such_feature') then raise exception 'feature gating failed: an unknown feature is on'; end if;
  begin
    insert into public.app_features (key) values ('self_granted');
    raise exception 'feature gating failed: a client created a feature';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.app_features set enabled_for_all = true where key = 'method_import';
    raise exception 'feature gating failed: a client switched a feature on for everyone';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_features (user_id, feature_key) values (u1, 'method_import');
    raise exception 'feature gating failed: a client granted itself a feature';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  insert into public.user_features (user_id, feature_key) values (u1, 'method_import');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  if not public.feature_enabled('method_import') then raise exception 'feature gating failed: an allowlisted user is off'; end if;
  if public.feature_enabled('review_hub') then raise exception 'feature gating failed: one grant enabled another feature'; end if;
  select count(*) into n from public.user_features;
  if n <> 1 then raise exception 'feature gating failed: user sees % allowlist rows', n; end if;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  if public.feature_enabled('method_import') then raise exception 'feature gating failed: another user is on'; end if;
  select count(*) into n from public.user_features;
  if n <> 0 then raise exception 'feature gating failed: another user sees allowlist rows'; end if;
  execute 'reset role';

  update public.app_features set enabled_for_all = true where key = 'method_import';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u2::text, true);
  if not public.feature_enabled('method_import') then raise exception 'feature gating failed: enabled_for_all did not enable everyone'; end if;
  execute 'reset role';
end;
$test$;

select jsonb_build_object('contract', 'feature-gating-v1') as feature_gating_contract;

rollback;
