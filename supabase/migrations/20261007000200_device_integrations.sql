-- Device integrations (Oura first): connection credentials and synced daily metrics.
--
-- Rules this schema enforces:
--   * Credentials (device_connections) are server-only: no role but service_role can read
--     or write them. RLS is on and forced, and anon/authenticated have no grants at all.
--   * Synced metrics (device_daily_metrics) are readable by their owner only and are
--     written only by the server (service role). Visitors cannot insert or update.
--   * Everything cascades from auth.users, so deleting an account removes it.
--   * Device data is display-only. It must never be sent to an AI model (Oura API
--     agreement); tests/devices/no-ai.test.ts guards the code side of that.
--   * The Oura connection is gated by the oura_beta feature, granted per user.
--
-- Online execution requires Sylvan's go-ahead.

begin;

insert into public.app_features (key, note) values
  ('oura_beta', 'Oura 睡眠 / 准备度 / 活动趋势：只展示，不进 AI。逐个用户授权。')
on conflict (key) do nothing;

create table public.device_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('oura')),
  -- AES-256-GCM ciphertext written by the app ("v1:iv:tag:data"); never plaintext.
  access_token_enc text not null,
  refresh_token_enc text,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

comment on table public.device_connections is
  'OAuth credentials for connected devices. Server-only (service role); encrypted by the app.';

alter table public.device_connections enable row level security;
alter table public.device_connections force row level security;
revoke all on public.device_connections from anon, authenticated;

create table public.device_daily_metrics (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('oura')),
  day date not null,
  sleep_score smallint check (sleep_score between 0 and 100),
  readiness_score smallint check (readiness_score between 0 and 100),
  activity_score smallint check (activity_score between 0 and 100),
  steps integer check (steps >= 0),
  active_calories integer check (active_calories >= 0),
  synced_at timestamptz not null default now(),
  primary key (user_id, provider, day)
);

comment on table public.device_daily_metrics is
  'Daily summaries synced from a connected device. Display only; never an AI input.';

alter table public.device_daily_metrics enable row level security;
alter table public.device_daily_metrics force row level security;
revoke all on public.device_daily_metrics from anon, authenticated;
grant select on public.device_daily_metrics to authenticated;

create policy device_daily_metrics_select_own on public.device_daily_metrics
  for select to authenticated
  using (user_id = (select auth.uid()));

commit;
