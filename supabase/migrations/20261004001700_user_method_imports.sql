-- Method import foundation F4: resumable imports, consent, and per-user quota.
begin;
create table public.user_method_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'extracting', 'review', 'published', 'failed', 'discarded')),
  raw_text text check (raw_text is null or length(raw_text) <= 30000),
  text_checksum_sha256 text not null check (text_checksum_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_draft jsonb check (manifest_draft is null or jsonb_typeof(manifest_draft) = 'object'),
  open_questions_count integer not null default 0 check (open_questions_count >= 0),
  consent_version text not null check (length(consent_version) between 1 and 40),
  consented_at timestamptz not null,
  published_method_id uuid references public.methods(id) on delete set null,
  failure_reason text,
  raw_text_purge_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_method_imports_user_idx on public.user_method_imports(user_id, created_at desc);

create function public.enforce_import_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from (select auth.uid()) then
    return new;
  end if;
  if (select count(*) from public.user_method_imports i
       where i.user_id = new.user_id and i.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Import limit reached (5 per 24 hours)' using errcode = '54000';
  end if;
  return new;
end
$$;
create trigger user_method_imports_quota before insert on public.user_method_imports
  for each row execute function public.enforce_import_quota();
revoke all on function public.enforce_import_quota() from public, anon, authenticated;

alter table public.user_method_imports enable row level security;
alter table public.user_method_imports force row level security;
revoke all on table public.user_method_imports from anon, authenticated;
grant select, insert, update on table public.user_method_imports to authenticated;
create policy user_method_imports_select_own on public.user_method_imports
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_method_imports_insert_own on public.user_method_imports
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'draft');
create policy user_method_imports_update_own on public.user_method_imports
  for update to authenticated
  using (user_id = (select auth.uid()) and status in ('draft', 'extracting', 'review', 'failed'))
  with check (user_id = (select auth.uid()) and status in ('draft', 'extracting', 'review', 'failed', 'discarded'));
commit;
