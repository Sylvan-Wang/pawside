-- 合约：复盘设置与已读状态（sql/04）、灰度开关（sql/05）。
-- rollback-only。

begin;

do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  n integer;
  rec record;
begin
  insert into auth.users (id, email) values (u1, 'u1@contract.test'), (u2, 'u2@contract.test');

  -- ===== 04：复盘设置与已读状态 =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  insert into public.user_review_settings (user_id) values (u1);
  select * into rec from public.user_review_settings where user_id = u1;
  if not (rec.day_enabled and rec.week_enabled and rec.month_enabled
          and rec.generation_mode = 'auto' and rec.pin_mode = 'until_read') then
    raise exception 'review settings failed: defaults do not match the document';
  end if;
  update public.user_review_settings set generation_mode = 'manual', month_enabled = false where user_id = u1;
  select * into rec from public.user_review_settings where user_id = u1;
  if rec.generation_mode <> 'manual' or rec.month_enabled then
    raise exception 'review settings failed: owner cannot update own settings';
  end if;
  begin
    update public.user_review_settings set generation_mode = 'weird' where user_id = u1;
    raise exception 'review settings failed: an invalid generation_mode was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.user_review_settings set pin_mode = 'forever' where user_id = u1;
    raise exception 'review settings failed: an invalid pin_mode was accepted';
  exception when check_violation then null;
  end;
  begin
    delete from public.user_review_settings where user_id = u1;
    raise exception 'review settings failed: a client deleted a settings row';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.user_review_settings;
  if n <> 0 then raise exception 'review settings failed: another user can read these settings'; end if;
  begin
    insert into public.user_review_settings (user_id) values (u1);
    raise exception 'review settings failed: a user inserted settings for another user';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', u1::text, true);
  insert into public.user_review_reads (user_id, tier, period_start) values (u1, 'week', date '2026-09-21')
    on conflict (user_id, tier, period_start) do update set read_at = now();
  insert into public.user_review_reads (user_id, tier, period_start) values (u1, 'week', date '2026-09-21')
    on conflict (user_id, tier, period_start) do update set read_at = now();
  select count(*) into n from public.user_review_reads;
  if n <> 1 then raise exception 'review reads failed: a repeated write created % rows', n; end if;
  begin
    insert into public.user_review_reads (user_id, tier, period_start) values (u1, 'year', date '2026-01-01');
    raise exception 'review reads failed: an invalid tier was accepted';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into n from public.user_review_reads;
  if n <> 0 then raise exception 'review reads failed: another user can read these rows'; end if;
  execute 'reset role';

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

select jsonb_build_object(
  'contract', 'review-settings-and-feature-gating-v1',
  'covers', jsonb_build_array('04 review settings and reads', '05 feature gating')
) as review_and_feature_contract;

rollback;
