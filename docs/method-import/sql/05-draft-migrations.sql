-- 草案，不是迁移。刻意放在 docs/ 下，不在 supabase/migrations/ 中，避免被误执行。
-- 文档 5 配套：灰度开关（功能开关 + 用户白名单），在数据库层强制。
-- 为什么必须在数据库层：登录用户对 security definer 函数有 execute 权限，
--   如果开关只在接口层判断，用户可以绕过接口直接调用函数。
-- 依赖：无。
-- 验证：2026-10-03 在本地 PostgreSQL 16 回放库中执行通过，并实测了：默认全部关闭、
--       加入白名单后仅该用户为开、全员开关打开后所有人为开、客户端无法写入开关表、
--       客户端只能读到自己的白名单行。
-- 线上执行前必须：用户明确同意（H8）。开关表的写入只能由你在 SQL 编辑器里执行。

begin;
create table public.app_features (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled_for_all boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

create table public.user_features (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null references public.app_features(key) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, feature_key)
);

insert into public.app_features (key, note) values
  ('multi_day_runtime', '多日方法的运行时（完成训练 v3、程序日 v2 等）'),
  ('method_import', '粘贴导入、私有方法、方法库'),
  ('adjustments', '个人调整层（换动作、隐藏、跳过某天）'),
  ('review_hub', '复盘中心（日/周/月）');

alter table public.app_features enable row level security;
alter table public.user_features enable row level security;
revoke all on table public.app_features, public.user_features from anon, authenticated;
grant select on table public.app_features, public.user_features to authenticated;
create policy app_features_authenticated_read on public.app_features for select to authenticated using (true);
create policy user_features_select_own on public.user_features
  for select to authenticated using (user_id = (select auth.uid()));

create function public.feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled_for_all from public.app_features f where f.key = p_key), false)
      or exists (select 1 from public.user_features u
                 where u.user_id = (select auth.uid()) and u.feature_key = p_key)
$$;
revoke all on function public.feature_enabled(text) from public, anon;
grant execute on function public.feature_enabled(text) to authenticated;
commit;
-- 回滚：drop function public.feature_enabled(text); drop table public.user_features; drop table public.app_features;

-- 使用方式（由各新函数的第一行调用，未开启时抛错）：
--   if not public.feature_enabled('method_import') then
--     raise exception 'Feature not enabled' using errcode = '42501';
--   end if;
-- 运维（由你在 SQL 编辑器执行）：
--   给某个用户开启：insert into public.user_features(user_id, feature_key) values ('<uuid>', 'method_import');
--   全员开启：update public.app_features set enabled_for_all = true, updated_at = now() where key = 'method_import';
--   紧急关闭：update public.app_features set enabled_for_all = false where key = 'method_import';
--             delete from public.user_features where feature_key = 'method_import';
