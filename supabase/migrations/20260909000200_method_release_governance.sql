-- Pawside 2.0 Phase 1: release-scoped canonical Method data and activation gates.

begin;

create table public.canonical_import_runs (
  id uuid primary key default gen_random_uuid(),
  method_id uuid not null references public.methods(id) on delete cascade,
  workbook_version text not null,
  workbook_checksum_sha256 text not null check (workbook_checksum_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  importer_version text not null,
  status text not null check (
    status in ('validating', 'rejected', 'draft_created', 'validated', 'failed')
  ),
  validation_report_json jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_report_json) = 'object'),
  diff_json jsonb not null default '{}'::jsonb check (jsonb_typeof(diff_json) = 'object'),
  row_counts_json jsonb not null default '{}'::jsonb check (jsonb_typeof(row_counts_json) = 'object'),
  release_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  check ((status = 'validating' and completed_at is null) or status <> 'validating')
);

create index canonical_import_runs_method_idx
  on public.canonical_import_runs(method_id, started_at desc);

create table public.method_releases (
  id uuid primary key default gen_random_uuid(),
  method_id uuid not null references public.methods(id) on delete cascade,
  version text not null,
  status text not null default 'draft' check (
    status in ('draft', 'blocked', 'validated', 'active', 'retired', 'rejected')
  ),
  release_channel text not null default 'internal_beta' check (
    release_channel in ('internal_beta', 'production')
  ),
  release_policy text not null default 'v1_runtime' check (
    release_policy in ('v1_runtime', 'strict_method')
  ),
  runtime_gate_status text not null default 'pending' check (
    runtime_gate_status in ('pending', 'passed', 'blocked')
  ),
  strict_gate_status text not null default 'pending' check (
    strict_gate_status in ('pending', 'passed', 'blocked')
  ),
  workbook_checksum_sha256 text check (
    workbook_checksum_sha256 is null or workbook_checksum_sha256 ~ '^[A-Fa-f0-9]{64}$'
  ),
  source_set_checksum_sha256 text check (
    source_set_checksum_sha256 is null or source_set_checksum_sha256 ~ '^[A-Fa-f0-9]{64}$'
  ),
  canonical_import_run_id uuid unique references public.canonical_import_runs(id) on delete set null,
  validation_report_json jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_report_json) = 'object'),
  release_notes text,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  unique (method_id, version)
);

alter table public.canonical_import_runs
  add constraint canonical_import_runs_release_fk
  foreign key (release_id) references public.method_releases(id) on delete set null;

create unique index method_releases_one_active_channel_idx
  on public.method_releases(method_id, release_channel)
  where status = 'active';

create or replace function public.validate_method_release_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' then
    if new.runtime_gate_status <> 'passed' then
      raise exception 'Runtime gate must pass before Method release activation';
    end if;

    if new.release_channel = 'production' and new.strict_gate_status <> 'passed' then
      raise exception 'Production activation requires Strict Method gate to pass';
    end if;

    if new.validated_at is null then
      raise exception 'Validated timestamp is required before activation';
    end if;

    if new.activated_at is null then
      new.activated_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger method_releases_validate_activation
  before insert or update on public.method_releases
  for each row execute function public.validate_method_release_activation();

create or replace function public.protect_active_method_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'active' then
      raise exception 'Active Method releases cannot be deleted';
    end if;
    return old;
  end if;

  if old.status = 'active' then
    if new.status = 'retired'
       and (to_jsonb(new) - array['status', 'retired_at']) =
           (to_jsonb(old) - array['status', 'retired_at']) then
      return new;
    end if;
    raise exception 'Active Method releases are immutable; create a new release';
  end if;

  return new;
end;
$$;

create trigger method_releases_protect_active
  before update or delete on public.method_releases
  for each row execute function public.protect_active_method_release();

insert into public.method_releases (
  method_id,
  version,
  status,
  release_channel,
  release_policy,
  runtime_gate_status,
  strict_gate_status,
  release_notes
)
select
  m.id,
  'legacy-structural-' || m.version,
  'draft',
  'internal_beta',
  'v1_runtime',
  'blocked',
  'blocked',
  'Backfilled from pre-release-governance Method structure. Not activatable.'
from public.methods m
on conflict (method_id, version) do nothing;

alter table public.method_splits
  add column method_release_id uuid references public.method_releases(id) on delete cascade;

update public.method_splits s
set method_release_id = r.id
from public.method_releases r
where r.method_id = s.method_id
  and r.version = 'legacy-structural-' || (
    select m.version from public.methods m where m.id = s.method_id
  )
  and s.method_release_id is null;

alter table public.method_splits alter column method_release_id set not null;
alter table public.method_splits drop constraint if exists method_splits_method_id_key_key;
alter table public.method_splits drop constraint if exists method_splits_method_id_order_index_key;
alter table public.method_splits add constraint method_splits_release_key_unique unique (method_release_id, key);
alter table public.method_splits add constraint method_splits_release_order_unique unique (method_release_id, order_index);

alter table public.method_rules
  add column method_release_id uuid references public.method_releases(id) on delete cascade,
  add column source_authority text not null default 'unresolved' check (
    source_authority in ('method_explicit', 'official_reconstructed', 'product_execution_default', 'unresolved')
  ),
  add column runtime_status text not null default 'inactive' check (
    runtime_status in ('active', 'fallback_active', 'inactive')
  ),
  add column confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  add column source_note text,
  add column canonical_status text not null default 'draft' check (
    canonical_status in ('draft', 'active', 'inactive', 'evidence_incomplete')
  ),
  add column evidence_required boolean not null default false,
  add column config_schema_version integer not null default 1 check (config_schema_version > 0);

update public.method_rules mr
set method_release_id = r.id
from public.method_releases r
where r.method_id = mr.method_id
  and r.version = 'legacy-structural-' || (
    select m.version from public.methods m where m.id = mr.method_id
  )
  and mr.method_release_id is null;

alter table public.method_rules alter column method_release_id set not null;
alter table public.method_rules drop constraint if exists method_rules_rule_type_check;
alter table public.method_rules add constraint method_rules_rule_type_check check (
  rule_type in (
    'principle', 'prescription', 'technique', 'progression', 'calibration',
    'recovery', 'warmup', 'regression', 'substitution'
  )
);
alter table public.method_rules drop constraint if exists method_rules_method_id_rule_key_version_key;
alter table public.method_rules add constraint method_rules_release_rule_key_unique unique (method_release_id, rule_key);

alter table public.method_split_exercises
  add column technique_rule_key text,
  add column purpose_rule_key text,
  add column field_provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_provenance) = 'object');

alter table public.method_split_exercises alter column prescription_rule_key drop not null;
alter table public.method_split_exercises alter column progression_rule_key drop not null;

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

create trigger method_splits_protect_active
  before insert or update or delete on public.method_splits
  for each row execute function public.protect_active_method_content();
create trigger method_rules_protect_active
  before insert or update or delete on public.method_rules
  for each row execute function public.protect_active_method_content();
create trigger method_split_exercises_protect_active
  before insert or update or delete on public.method_split_exercises
  for each row execute function public.protect_active_method_content();

alter table public.canonical_import_runs enable row level security;
alter table public.canonical_import_runs force row level security;
alter table public.method_releases enable row level security;
alter table public.method_releases force row level security;

comment on column public.method_rules.source_authority is
  'Field or rule authority. product_execution_default must never be described as author instruction.';
comment on column public.method_split_exercises.field_provenance is
  'Field-level authority map for mixed prescriptions such as method-explicit sets plus product-default reps.';

commit;
