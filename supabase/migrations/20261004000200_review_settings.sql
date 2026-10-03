-- Method import foundation F1: review settings and read state.
begin;
create table public.user_review_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day_enabled boolean not null default true,
  week_enabled boolean not null default true,
  month_enabled boolean not null default true,
  generation_mode text not null default 'auto' check (generation_mode in ('auto', 'manual')),
  pin_mode text not null default 'until_read' check (pin_mode in ('until_read', 'three_days')),
  updated_at timestamptz not null default now()
);

create table public.user_review_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null check (tier in ('day', 'week', 'month')),
  period_start date not null,
  read_at timestamptz not null default now(),
  primary key (user_id, tier, period_start)
);

alter table public.user_review_settings enable row level security;
alter table public.user_review_settings force row level security;
alter table public.user_review_reads enable row level security;
alter table public.user_review_reads force row level security;
revoke all on table public.user_review_settings, public.user_review_reads from anon, authenticated;
grant select, insert, update on table public.user_review_settings to authenticated;
grant select, insert, update on table public.user_review_reads to authenticated;

create policy user_review_settings_select_own on public.user_review_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_review_settings_insert_own on public.user_review_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_review_settings_update_own on public.user_review_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy user_review_reads_select_own on public.user_review_reads
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_review_reads_insert_own on public.user_review_reads
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_review_reads_update_own on public.user_review_reads
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
commit;
