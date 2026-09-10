-- Pawside 2.0 Phase 1: Method, enrollment and prescription foundation.
-- Prescription and progression values are intentionally not seeded until the
-- authoritative Method Tracking dataset is supplied.

create table public.methods (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  version text not null,
  status text not null check (status in ('draft', 'active', 'archived')),
  description text,
  source_type text not null check (source_type in ('official', 'imported')),
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(key, version)
);

create table public.method_splits (
  id uuid primary key default gen_random_uuid(),
  method_id uuid not null references public.methods(id) on delete cascade,
  key text not null check (key in ('push', 'pull', 'legs')),
  name_zh text not null,
  order_index integer not null check (order_index between 1 and 3),
  primary_focus text[] not null default '{}',
  description text,
  created_at timestamptz not null default now(),
  unique(method_id, key),
  unique(method_id, order_index)
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  canonical_name_zh text not null unique,
  canonical_name_en text,
  aliases text[] not null default '{}',
  movement_pattern text,
  target_regions text[] not null default '{}',
  equipment text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exercise_media (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'image_start', 'image_end', 'gif', 'video', 'thumbnail')),
  storage_path text,
  external_url text,
  view_angle text check (view_angle is null or view_angle in ('front', 'side', 'three_quarter', 'other')),
  source_name text,
  license_metadata jsonb,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (storage_path is not null or external_url is not null)
);

-- External slugs identify provider assets only. Pawside exercise_id remains the FK.
create table public.exercise_external_mappings (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  provider text not null,
  external_slug text not null,
  source_version text not null,
  license text not null,
  attribution text not null,
  source_url text,
  created_at timestamptz not null default now(),
  unique(provider, external_slug, source_version),
  unique(exercise_id, provider, source_version)
);

create table public.method_rules (
  id uuid primary key default gen_random_uuid(),
  method_id uuid not null references public.methods(id) on delete cascade,
  rule_key text not null,
  rule_type text not null check (rule_type in ('prescription', 'progression', 'recovery', 'warmup', 'regression', 'substitution')),
  version text not null,
  config_json jsonb not null,
  explanation_zh text,
  status text not null check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  unique(method_id, rule_key, version)
);

create table public.method_split_exercises (
  id uuid primary key default gen_random_uuid(),
  method_split_id uuid not null references public.method_splits(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  order_index integer not null check (order_index > 0),
  method_role text not null check (method_role in ('primary', 'secondary', 'accessory', 'isolation', 'development')),
  prescription_rule_key text not null,
  progression_rule_key text not null,
  regression_rule_key text,
  substitution_rule_key text,
  warmup_rule_key text,
  method_notes text,
  unique(method_split_id, exercise_id),
  unique(method_split_id, order_index)
);

create table public.method_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  method_id uuid not null references public.methods(id),
  status text not null check (status in ('active', 'paused', 'completed', 'archived')),
  started_at timestamptz not null default now(),
  current_cycle_number integer not null default 1 check (current_cycle_number > 0),
  next_split_key text not null default 'push' check (next_split_key in ('push', 'pull', 'legs')),
  current_state text not null default 'ready' check (current_state in ('ready', 'recovery_check', 'rest', 'session_in_progress')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index method_enrollments_one_active_per_user_idx
  on public.method_enrollments(user_id) where status = 'active';
create index method_enrollments_user_idx on public.method_enrollments(user_id, created_at desc);

create table public.method_cycles (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.method_enrollments(id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Phase 2 adds FKs after workout_sessions exists.
  push_session_id uuid,
  pull_session_id uuid,
  legs_session_id uuid,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  unique(enrollment_id, cycle_number),
  check ((status = 'completed' and completed_at is not null) or status = 'in_progress')
);

create table public.user_exercise_progression (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.method_enrollments(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  progression_rule_key text not null,
  current_stage_key text not null,
  current_reference_weight_kg numeric(7,3) check (current_reference_weight_kg is null or current_reference_weight_kg >= 0),
  stage_started_at timestamptz not null default now(),
  last_evaluated_at timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  state_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enrollment_id, exercise_id)
);

create index user_exercise_progression_user_idx
  on public.user_exercise_progression(user_id, enrollment_id);

create table public.session_prescriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.method_enrollments(id) on delete cascade,
  cycle_id uuid references public.method_cycles(id) on delete set null,
  method_split_id uuid not null references public.method_splits(id),
  split_key text not null check (split_key in ('push', 'pull', 'legs')),
  planned_for_date date,
  status text not null check (status in ('upcoming', 'ready', 'started', 'completed', 'rest_deferred', 'cancelled')),
  generated_from_rule_version text not null,
  -- Phase 7 adds the FK after recovery_decisions exists.
  recovery_decision_id uuid,
  generated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index session_prescriptions_one_open_split_idx
  on public.session_prescriptions(enrollment_id, cycle_id, split_key)
  where status in ('upcoming', 'ready', 'started', 'rest_deferred');
create index session_prescriptions_user_status_idx
  on public.session_prescriptions(user_id, status, generated_at desc);

create table public.exercise_prescriptions (
  id uuid primary key default gen_random_uuid(),
  session_prescription_id uuid not null references public.session_prescriptions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  order_index integer not null check (order_index > 0),
  method_role text not null,
  progression_stage_key text not null,
  target_summary_zh text,
  target_weight_kg numeric(7,3) check (target_weight_kg is null or target_weight_kg >= 0),
  weight_guidance_type text check (weight_guidance_type is null or weight_guidance_type in ('calibration', 'historical_reference', 'fixed', 'user_select')),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'modified', 'skipped')),
  created_at timestamptz not null default now(),
  unique(session_prescription_id, exercise_id),
  unique(session_prescription_id, order_index)
);

create table public.set_prescriptions (
  id uuid primary key default gen_random_uuid(),
  exercise_prescription_id uuid not null references public.exercise_prescriptions(id) on delete cascade,
  set_index integer not null check (set_index > 0),
  set_type text not null check (set_type in ('warmup', 'working', 'failure', 'rest_pause', 'backoff', 'other')),
  target_reps_min integer check (target_reps_min is null or target_reps_min >= 0),
  target_reps_max integer check (target_reps_max is null or target_reps_max >= 0),
  target_rpe numeric(4,2) check (target_rpe is null or target_rpe between 0 and 10),
  target_rir numeric(4,2) check (target_rir is null or target_rir >= 0),
  failure_allowed boolean not null default false,
  failure_required boolean not null default false,
  target_weight_kg numeric(7,3) check (target_weight_kg is null or target_weight_kg >= 0),
  rest_min_seconds integer check (rest_min_seconds is null or rest_min_seconds >= 0),
  rest_max_seconds integer check (rest_max_seconds is null or rest_max_seconds >= 0),
  quality_requirement text,
  created_at timestamptz not null default now(),
  unique(exercise_prescription_id, set_index),
  check (target_reps_min is null or target_reps_max is null or target_reps_min <= target_reps_max),
  check (rest_min_seconds is null or rest_max_seconds is null or rest_min_seconds <= rest_max_seconds),
  check (not failure_required or failure_allowed)
);

-- Immutable reference data is readable by signed-in users and writable only by migrations/admin.
alter table public.methods enable row level security;
alter table public.method_splits enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_media enable row level security;
alter table public.exercise_external_mappings enable row level security;
alter table public.method_rules enable row level security;
alter table public.method_split_exercises enable row level security;

create policy methods_authenticated_read on public.methods for select to authenticated using (true);
create policy method_splits_authenticated_read on public.method_splits for select to authenticated using (true);
create policy exercises_authenticated_read on public.exercises for select to authenticated using (true);
create policy exercise_media_authenticated_read on public.exercise_media for select to authenticated using (true);
create policy exercise_external_mappings_authenticated_read on public.exercise_external_mappings for select to authenticated using (true);
create policy method_rules_authenticated_read on public.method_rules for select to authenticated using (true);
create policy method_split_exercises_authenticated_read on public.method_split_exercises for select to authenticated using (true);

alter table public.method_enrollments enable row level security;
alter table public.method_enrollments force row level security;
alter table public.method_cycles enable row level security;
alter table public.method_cycles force row level security;
alter table public.user_exercise_progression enable row level security;
alter table public.user_exercise_progression force row level security;
alter table public.session_prescriptions enable row level security;
alter table public.session_prescriptions force row level security;
alter table public.exercise_prescriptions enable row level security;
alter table public.exercise_prescriptions force row level security;
alter table public.set_prescriptions enable row level security;
alter table public.set_prescriptions force row level security;

create policy method_enrollments_select_own on public.method_enrollments
  for select to authenticated using (user_id = (select auth.uid()));
create policy method_cycles_select_own on public.method_cycles
  for select to authenticated using (
    exists (select 1 from public.method_enrollments e where e.id = enrollment_id and e.user_id = (select auth.uid()))
  );
create policy user_exercise_progression_select_own on public.user_exercise_progression
  for select to authenticated using (user_id = (select auth.uid()));
create policy session_prescriptions_select_own on public.session_prescriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy exercise_prescriptions_select_own on public.exercise_prescriptions
  for select to authenticated using (
    exists (
      select 1 from public.session_prescriptions s
      where s.id = session_prescription_id and s.user_id = (select auth.uid())
    )
  );
create policy set_prescriptions_select_own on public.set_prescriptions
  for select to authenticated using (
    exists (
      select 1
      from public.exercise_prescriptions ep
      join public.session_prescriptions sp on sp.id = ep.session_prescription_id
      where ep.id = exercise_prescription_id and sp.user_id = (select auth.uid())
    )
  );

create trigger methods_set_updated_at before update on public.methods
  for each row execute function public.set_updated_at();
create trigger exercises_set_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();
create trigger method_enrollments_set_updated_at before update on public.method_enrollments
  for each row execute function public.set_updated_at();
create trigger user_exercise_progression_set_updated_at before update on public.user_exercise_progression
  for each row execute function public.set_updated_at();

-- Structural seed only. It remains draft until authoritative rules and the full
-- Push/Pull/Legs Method Tracking rows are loaded and validated.
insert into public.methods (
  key, name, version, status, description, source_type, source_metadata
)
values (
  'ksw_tcy_three_split_2026',
  '凯圣王 × 谭成义 2026 三分化',
  '1.0',
  'draft',
  'Pawside 2.0 官方三分化方法。当前仅完成结构初始化。',
  'official',
  jsonb_build_object(
    'tracking_status', 'awaiting_authoritative_dataset',
    'product_source', 'Pawside_2.0_Overview_PRD_全模块产品PRD_v0.1',
    'system_source', 'Pawside_2.0_System_Spec_v0.1',
    'raw_source_file', '【凯圣王】—凯圣王-谭成义三分化合集—【2026-04-24】-中文.txt',
    'raw_source_sha256', 'B32A3C04733378163FF3D38D27FCAAFC615BF5D2A367EE6CF22FB0FD7C297558',
    'raw_source_usage', 'evidence_and_explanation_only_until_tracking_confirmation'
  )
)
on conflict (key, version) do nothing;

insert into public.method_splits (method_id, key, name_zh, order_index, primary_focus)
select m.id, seed.key, seed.name_zh, seed.order_index, seed.primary_focus
from public.methods m
cross join (
  values
    ('push', '推', 1, array[]::text[]),
    ('pull', '拉', 2, array[]::text[]),
    ('legs', '腿', 3, array[]::text[])
) as seed(key, name_zh, order_index, primary_focus)
where m.key = 'ksw_tcy_three_split_2026' and m.version = '1.0'
on conflict (method_id, key) do nothing;

-- These five Push exercise identities are explicitly named in the PRD.
-- Roles, rule keys, stages, sets and media mappings remain intentionally unset.
insert into public.exercises (canonical_name_zh)
values
  ('杠铃卧推'),
  ('上斜哑铃卧推'),
  ('双杠臂屈伸'),
  ('仰卧杠铃臂屈伸'),
  ('Y 字侧平举')
on conflict (canonical_name_zh) do nothing;
