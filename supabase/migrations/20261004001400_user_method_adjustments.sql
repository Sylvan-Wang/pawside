-- Method import foundation F3: immutable-release personalization layer.
begin;
create table public.user_method_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.method_enrollments(id) on delete restrict,
  split_key text not null check (split_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  exercise_id uuid references public.exercises(id) on delete restrict,
  action text not null check (action in ('hide_exercise', 'swap_exercise', 'set_count', 'rep_range', 'skip_day')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (action = 'skip_day' or exercise_id is not null)
);
create index user_method_adjustments_enrollment_idx
  on public.user_method_adjustments(enrollment_id, split_key) where revoked_at is null;
alter table public.user_method_adjustments enable row level security;
alter table public.user_method_adjustments force row level security;
revoke all on table public.user_method_adjustments from anon, authenticated;
grant select on table public.user_method_adjustments to authenticated;
create policy user_method_adjustments_select_own on public.user_method_adjustments
  for select to authenticated using (user_id = (select auth.uid()));
commit;
