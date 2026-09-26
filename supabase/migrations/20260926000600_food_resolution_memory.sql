-- Pawside Nutrition Intake Resolution P0: confirmed personal memory and
-- non-canonical candidate cache. Neither table can mutate the canonical corpus.
begin;

create table if not exists public.user_food_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_name text not null,
  raw_name text not null,
  brand text,
  energy_kcal_per_100g numeric(10,2),
  protein_g_per_100g numeric(10,2),
  carb_g_per_100g numeric(10,2),
  fat_g_per_100g numeric(10,2),
  fiber_g_per_100g numeric(10,2),
  source_type text not null check (source_type in ('ai_estimate','user_override','candidate_cache')),
  source_ref_id text,
  last_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_name)
);

create index if not exists user_food_memory_lookup_idx
  on public.user_food_memory(user_id, normalized_name);

alter table public.user_food_memory enable row level security;
alter table public.user_food_memory force row level security;
drop trigger if exists user_food_memory_set_updated_at on public.user_food_memory;
create trigger user_food_memory_set_updated_at
  before update on public.user_food_memory
  for each row execute function public.set_updated_at();
drop policy if exists user_food_memory_manage_own on public.user_food_memory;
create policy user_food_memory_manage_own on public.user_food_memory
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.food_resolution_candidates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  normalized_name text not null,
  raw_name text not null,
  brand text,
  energy_kcal_per_100g numeric(10,2),
  protein_g_per_100g numeric(10,2),
  carb_g_per_100g numeric(10,2),
  fat_g_per_100g numeric(10,2),
  fiber_g_per_100g numeric(10,2),
  source_type text not null check (source_type in ('ai_estimate','external_structured')),
  source_detail jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  confirm_count integer not null default 1 check (confirm_count >= 0),
  override_count integer not null default 0 check (override_count >= 0),
  last_used_at timestamptz not null default now(),
  status text not null default 'provisional'
    check (status in ('provisional','reused','reviewed','promoted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists food_resolution_candidates_lookup_idx
  on public.food_resolution_candidates(normalized_name, status);

alter table public.food_resolution_candidates enable row level security;
alter table public.food_resolution_candidates force row level security;
drop trigger if exists food_resolution_candidates_set_updated_at on public.food_resolution_candidates;
create trigger food_resolution_candidates_set_updated_at
  before update on public.food_resolution_candidates
  for each row execute function public.set_updated_at();
drop policy if exists food_resolution_candidates_read on public.food_resolution_candidates;
create policy food_resolution_candidates_read on public.food_resolution_candidates
  for select to authenticated
  using (
    confirm_count > 0
    and (
      created_by = (select auth.uid())
      or status in ('reviewed', 'promoted')
    )
  );
drop policy if exists food_resolution_candidates_insert_own on public.food_resolution_candidates;
create policy food_resolution_candidates_insert_own on public.food_resolution_candidates
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'provisional'
    and source_type = 'ai_estimate'
  );
drop policy if exists food_resolution_candidates_update_own on public.food_resolution_candidates;
create policy food_resolution_candidates_update_own on public.food_resolution_candidates
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (
    created_by = (select auth.uid())
    and status in ('provisional', 'reused')
  );

comment on table public.user_food_memory is
  'User-confirmed non-canonical food memory. Personal values never write foods or food_nutrition.';
comment on table public.food_resolution_candidates is
  'Confirmed AI/external candidates. P0 cache only; promotion to canonical requires a later reviewed workflow.';

commit;
