-- Pawside 2.0 Phase 1: immutable Method source registry and evidence chunks.
-- Runtime prescription logic must never depend on XLSX or source chunks being
-- available online.

begin;

create table public.method_source_documents (
  id uuid primary key default gen_random_uuid(),
  method_id uuid not null references public.methods(id) on delete cascade,
  source_key text not null,
  source_type text not null check (
    source_type in ('transcript', 'official_video', 'prd', 'spec', 'workbook', 'product_patch')
  ),
  title text not null,
  version text not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  source_uri text,
  status text not null default 'registered' check (
    status in ('registered', 'ingested', 'superseded', 'missing')
  ),
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (method_id, source_key, version, checksum_sha256)
);

create index method_source_documents_lookup_idx
  on public.method_source_documents(method_id, source_key, status, created_at desc);

create table public.method_source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.method_source_documents(id) on delete cascade,
  method_id uuid not null references public.methods(id) on delete cascade,
  chunk_key text not null,
  ordinal integer not null check (ordinal > 0),
  section_key text,
  split_key text check (split_key is null or split_key in ('push', 'pull', 'legs')),
  exercise_id uuid references public.exercises(id) on delete set null,
  topic text not null,
  content text not null check (btrim(content) <> ''),
  source_locator_json jsonb not null default '{}'::jsonb check (jsonb_typeof(source_locator_json) = 'object'),
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  content_checksum_sha256 text not null check (content_checksum_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  embedding jsonb,
  embedding_model text,
  embedding_dimensions integer check (embedding_dimensions is null or embedding_dimensions > 0),
  created_at timestamptz not null default now(),
  unique (source_document_id, chunk_key),
  unique (source_document_id, ordinal),
  check (
    (embedding is null and embedding_model is null and embedding_dimensions is null)
    or
    (embedding is not null and embedding_model is not null and embedding_dimensions is not null)
  )
);

create index method_source_chunks_lexical_idx
  on public.method_source_chunks using gin (to_tsvector('simple', content));
create index method_source_chunks_filter_idx
  on public.method_source_chunks(method_id, topic, split_key, exercise_id);

alter table public.method_source_documents enable row level security;
alter table public.method_source_documents force row level security;
alter table public.method_source_chunks enable row level security;
alter table public.method_source_chunks force row level security;

comment on table public.method_source_documents is
  'Immutable source identities. A changed file must be inserted with a new checksum.';
comment on table public.method_source_chunks is
  'Evidence retrieval only. Runtime prescription decisions read published canonical rules instead.';

commit;
