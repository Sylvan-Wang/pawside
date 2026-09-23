-- Pawside 2.0 transitional compatibility schema.
-- The target Supabase project is new and has no legacy data to migrate.
-- These tables only keep the current GitHub UI operational while each module
-- switches to the normalized 2.0 model. They are not new business truth.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  gender text check (gender is null or gender in ('male', 'female', 'other', '男', '女')),
  height_cm numeric(6,2) check (height_cm is null or height_cm > 0),
  reference_weight_kg numeric(7,3) check (reference_weight_kg is null or reference_weight_kg > 0),
  goal text check (goal is null or goal in ('gain_muscle', 'lose_fat', 'maintain', '增肌', '减脂', '保持')),
  onboarding_completed boolean not null default false,
  onboarding_version text,

  -- Transitional fields used by the current UI. Do not use as 2.0 Program truth.
  weight_kg numeric(7,3) check (weight_kg is null or weight_kg > 0),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  weekly_workout_target integer check (weekly_workout_target is null or weekly_workout_target >= 0),
  daily_calorie_target integer check (daily_calorie_target is null or daily_calorie_target >= 0),
  preferred_model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.user_profiles.weight_kg is
  'Deprecated compatibility field. Pawside 2.0 onboarding truth is reference_weight_kg.';
comment on column public.user_profiles.weekly_workout_target is
  'Deprecated compatibility field. Never use as Method adherence truth.';
comment on column public.user_profiles.daily_calorie_target is
  'Deprecated manual target. Keep only as an explicitly labelled fallback.';

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null,
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  notes text,
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workout_logs is
  'Deprecated write model retained temporarily for current UI compatibility. New workout facts use normalized execution tables.';

create index workout_logs_user_date_idx on public.workout_logs(user_id, date desc);

create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  meal_type text not null,
  foods jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.food_logs is
  'Deprecated write model retained temporarily for current UI compatibility. New nutrition facts use user_food_logs and items.';

create index food_logs_user_date_idx on public.food_logs(user_id, date desc);

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric(7,3) check (weight_kg is null or weight_kg > 0),
  body_fat_pct numeric(5,2) check (body_fat_pct is null or body_fat_pct between 0 and 100),
  muscle_mass numeric(7,3) check (muscle_mass is null or muscle_mass >= 0),
  chest_cm numeric(7,2),
  waist_cm numeric(7,2),
  hips_cm numeric(7,2),
  left_arm_cm numeric(7,2),
  right_arm_cm numeric(7,2),
  left_thigh_cm numeric(7,2),
  right_thigh_cm numeric(7,2),
  custom_metrics jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, date)
);

create index body_metrics_user_date_idx on public.body_metrics(user_id, date desc);

create table public.weekly_summary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  workout_count integer not null default 0,
  total_duration integer not null default 0,
  food_log_count integer not null default 0,
  avg_calories numeric(10,2),
  weight_change numeric(7,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, week_start)
);

comment on table public.weekly_summary is
  'Legacy presentation cache. Never use as Method adherence truth.';

create table public.ai_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_type text not null,
  status text not null default 'draft',
  source text,
  input_snapshot jsonb,
  plan_json jsonb,
  summary_text text,
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ai_plans is
  'Legacy AI output. It is never a Pawside Method or progression truth source.';

create index ai_plans_user_created_idx on public.ai_plans(user_id, created_at desc);

create table public.ai_generated_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null,
  target_date date not null,
  content_json jsonb,
  content_text text,
  prompt_version text,
  feedback text,
  is_stale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, content_type, target_date)
);

create index ai_generated_content_user_date_idx
  on public.ai_generated_content(user_id, target_date desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_profiles', 'workout_logs', 'food_logs', 'body_metrics',
    'weekly_summary', 'ai_plans', 'ai_generated_content'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

create policy user_profiles_select_own on public.user_profiles
  for select to authenticated using (id = (select auth.uid()));
create policy user_profiles_insert_own on public.user_profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy user_profiles_update_own on public.user_profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy workout_logs_manage_own on public.workout_logs
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy food_logs_manage_own on public.food_logs
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy body_metrics_manage_own on public.body_metrics
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy weekly_summary_manage_own on public.weekly_summary
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ai_plans_manage_own on public.ai_plans
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ai_generated_content_manage_own on public.ai_generated_content
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();
create trigger workout_logs_set_updated_at before update on public.workout_logs
  for each row execute function public.set_updated_at();
create trigger food_logs_set_updated_at before update on public.food_logs
  for each row execute function public.set_updated_at();
create trigger body_metrics_set_updated_at before update on public.body_metrics
  for each row execute function public.set_updated_at();
create trigger weekly_summary_set_updated_at before update on public.weekly_summary
  for each row execute function public.set_updated_at();
create trigger ai_plans_set_updated_at before update on public.ai_plans
  for each row execute function public.set_updated_at();
create trigger ai_generated_content_set_updated_at before update on public.ai_generated_content
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- If Auth users existed before this migration, create only their empty profile shell.
insert into public.user_profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

