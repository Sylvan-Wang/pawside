-- Method import program · F1: feature gating (app_features, user_features, feature_enabled).
-- Additive only. Source: docs/method-import/sql/05-draft-migrations.sql (branch claude/method-import-spec).
-- Online execution requires Sylvan's explicit go-ahead (charter H8).

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
