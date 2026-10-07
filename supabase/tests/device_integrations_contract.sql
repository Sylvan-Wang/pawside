-- Contract: device credentials are server-only; synced metrics are owner-read-only.
begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'device-a@pawside.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'device-b@pawside.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.device_connections (user_id, provider, access_token_enc, token_expires_at)
values ('70000000-0000-4000-8000-000000000001', 'oura', 'v1:test:test:test', now() + interval '1 day');

insert into public.device_daily_metrics (user_id, provider, day, sleep_score, readiness_score, steps)
values
  ('70000000-0000-4000-8000-000000000001', 'oura', date '2026-10-01', 80, 75, 7000),
  ('70000000-0000-4000-8000-000000000002', 'oura', date '2026-10-01', 60, 55, 3000);

do $test$
begin
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.device_connections'::regclass)
     or not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.device_daily_metrics'::regclass) then
    raise exception 'device tables must have forced row level security';
  end if;

  if not exists (select 1 from public.app_features where key = 'oura_beta' and enabled_for_all = false) then
    raise exception 'oura_beta must exist and stay off for everyone by default';
  end if;

  if has_table_privilege('authenticated', 'public.device_connections', 'SELECT')
     or has_table_privilege('authenticated', 'public.device_connections', 'INSERT')
     or has_table_privilege('authenticated', 'public.device_connections', 'UPDATE')
     or has_table_privilege('authenticated', 'public.device_connections', 'DELETE')
     or has_table_privilege('anon', 'public.device_connections', 'SELECT') then
    raise exception 'device_connections (credentials) must be unreachable from client roles';
  end if;

  if has_table_privilege('authenticated', 'public.device_daily_metrics', 'INSERT')
     or has_table_privilege('authenticated', 'public.device_daily_metrics', 'UPDATE')
     or has_table_privilege('authenticated', 'public.device_daily_metrics', 'DELETE')
     or has_table_privilege('anon', 'public.device_daily_metrics', 'SELECT') then
    raise exception 'device_daily_metrics must be read-only for signed-in users and closed to anon';
  end if;
end;
$test$;

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $test$
declare
  visible integer;
begin
  select count(*) into visible from public.device_daily_metrics;
  if visible <> 1 then
    raise exception 'a user must see only their own device metrics, saw %', visible;
  end if;

  begin
    perform 1 from public.device_connections;
    raise exception 'signed-in users must not be able to read device credentials';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.device_daily_metrics (user_id, provider, day, sleep_score)
    values ('70000000-0000-4000-8000-000000000001', 'oura', date '2026-10-02', 99);
    raise exception 'signed-in users must not be able to write device metrics';
  exception when insufficient_privilege then
    null;
  end;
end;
$test$;

rollback;
