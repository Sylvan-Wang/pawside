-- Pawside 2.0 Phase 1: evidence links, field-level provenance, release
-- blockers and separately versioned product adaptation policies.

begin;

create table public.method_rule_sources (
  id uuid primary key default gen_random_uuid(),
  method_rule_id uuid not null references public.method_rules(id) on delete cascade,
  source_chunk_id uuid not null references public.method_source_chunks(id) on delete restrict,
  evidence_key text not null,
  field_path text,
  relationship text not null check (
    relationship in ('explicit', 'derived', 'supporting', 'conflicting', 'product_default')
  ),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  review_status text not null default 'pending' check (
    review_status in ('pending', 'approved', 'rejected')
  ),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (method_rule_id, evidence_key, field_path)
);

create table public.method_prescription_field_values (
  id uuid primary key default gen_random_uuid(),
  method_split_exercise_id uuid not null references public.method_split_exercises(id) on delete cascade,
  method_rule_id uuid references public.method_rules(id) on delete set null,
  field_key text not null,
  value_json jsonb not null,
  source_authority text not null check (
    source_authority in ('method_explicit', 'official_reconstructed', 'product_execution_default', 'unresolved')
  ),
  runtime_status text not null check (
    runtime_status in ('active', 'fallback_active', 'inactive')
  ),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  evidence_key text,
  source_note text,
  created_at timestamptz not null default now(),
  unique (method_split_exercise_id, field_key)
);

create table public.method_release_issues (
  id uuid primary key default gen_random_uuid(),
  method_release_id uuid not null references public.method_releases(id) on delete cascade,
  issue_key text not null,
  scope text not null,
  status text not null check (
    status in ('open', 'resolved', 'accepted_runtime_default')
  ),
  blocks_v1_runtime_release boolean not null,
  blocks_strict_method_release boolean not null,
  resolution_json jsonb not null default '{}'::jsonb check (jsonb_typeof(resolution_json) = 'object'),
  source_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (method_release_id, issue_key)
);

create table public.adaptation_policy_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status text not null default 'draft' check (
    status in ('draft', 'blocked', 'validated', 'active', 'retired')
  ),
  workbook_checksum_sha256 text check (
    workbook_checksum_sha256 is null or workbook_checksum_sha256 ~ '^[A-Fa-f0-9]{64}$'
  ),
  validation_report_json jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_report_json) = 'object'),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null
);

create unique index adaptation_policy_releases_one_active_idx
  on public.adaptation_policy_releases((true))
  where status = 'active';

create table public.adaptation_policies (
  id uuid primary key default gen_random_uuid(),
  policy_release_id uuid not null references public.adaptation_policy_releases(id) on delete cascade,
  scenario_key text not null,
  trigger_json jsonb not null check (jsonb_typeof(trigger_json) = 'object'),
  input_contract_json jsonb not null default '{}'::jsonb check (jsonb_typeof(input_contract_json) = 'object'),
  safety_priority text not null check (safety_priority in ('critical', 'high', 'normal', 'low')),
  decision_json jsonb not null check (jsonb_typeof(decision_json) = 'object'),
  effects_json jsonb not null default '{}'::jsonb check (jsonb_typeof(effects_json) = 'object'),
  copy_template_json jsonb not null default '{}'::jsonb check (jsonb_typeof(copy_template_json) = 'object'),
  source_type text not null check (source_type in ('method', 'derived', 'product_policy', 'mixed')),
  evidence_key text,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (policy_release_id, scenario_key)
);

create or replace function public.protect_active_method_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_id_to_check uuid;
begin
  if tg_table_name in ('method_splits', 'method_rules') then
    if tg_op = 'DELETE' then
      release_id_to_check := old.method_release_id;
    else
      release_id_to_check := new.method_release_id;
    end if;
  elsif tg_table_name = 'method_split_exercises' then
    select s.method_release_id
    into release_id_to_check
    from public.method_splits s
    where s.id = case when tg_op = 'DELETE' then old.method_split_id else new.method_split_id end;
  elsif tg_table_name = 'method_rule_sources' then
    select r.method_release_id
    into release_id_to_check
    from public.method_rules r
    where r.id = case when tg_op = 'DELETE' then old.method_rule_id else new.method_rule_id end;
  elsif tg_table_name = 'method_prescription_field_values' then
    select s.method_release_id
    into release_id_to_check
    from public.method_split_exercises mse
    join public.method_splits s on s.id = mse.method_split_id
    where mse.id = case
      when tg_op = 'DELETE' then old.method_split_exercise_id
      else new.method_split_exercise_id
    end;
  elsif tg_table_name = 'method_release_issues' then
    if tg_op = 'DELETE' then
      release_id_to_check := old.method_release_id;
    else
      release_id_to_check := new.method_release_id;
    end if;
  end if;

  if exists (
    select 1 from public.method_releases r
    where r.id = release_id_to_check and r.status = 'active'
  ) then
    raise exception 'Canonical rows in an active Method release are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.protect_active_policy_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_id_to_check uuid;
begin
  release_id_to_check := coalesce(new.policy_release_id, old.policy_release_id);
  if exists (
    select 1 from public.adaptation_policy_releases r
    where r.id = release_id_to_check and r.status = 'active'
  ) then
    raise exception 'Policies in an active adaptation release are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger adaptation_policies_protect_active
  before update or delete on public.adaptation_policies
  for each row execute function public.protect_active_policy_content();

create trigger method_rule_sources_protect_active
  before insert or update or delete on public.method_rule_sources
  for each row execute function public.protect_active_method_content();

create trigger method_prescription_fields_protect_active
  before insert or update or delete on public.method_prescription_field_values
  for each row execute function public.protect_active_method_content();

create trigger method_release_issues_protect_active
  before insert or update or delete on public.method_release_issues
  for each row execute function public.protect_active_method_content();

alter table public.method_rule_sources enable row level security;
alter table public.method_rule_sources force row level security;
alter table public.method_prescription_field_values enable row level security;
alter table public.method_prescription_field_values force row level security;
alter table public.method_release_issues enable row level security;
alter table public.method_release_issues force row level security;
alter table public.adaptation_policy_releases enable row level security;
alter table public.adaptation_policy_releases force row level security;
alter table public.adaptation_policies enable row level security;
alter table public.adaptation_policies force row level security;

commit;
