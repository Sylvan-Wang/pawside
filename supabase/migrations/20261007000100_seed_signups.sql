-- Seed-user sign-ups from the public website (/welcome): an optional name and an email.
--
-- Write-only for visitors: anon/authenticated may INSERT and nothing else, so the list
-- cannot be read through the public API. Read it in the Supabase dashboard (service role).
-- Duplicate emails are rejected by the unique index; the API treats that as success so the
-- form never reveals whether an address is already on the list.
--
-- Not user-owned data (no auth.users reference): rows are kept until the person asks for
-- removal by email (see the privacy policy), then deleted by hand.
--
-- Online execution requires Sylvan's go-ahead.

begin;

create table if not exists public.seed_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null
    check (char_length(email) between 3 and 254 and email = lower(email) and email like '%_@_%._%'),
  name text check (name is null or char_length(name) <= 40),
  source text not null default 'welcome' check (char_length(source) <= 40),
  created_at timestamptz not null default now()
);

create unique index if not exists seed_signups_email_key on public.seed_signups (email);

comment on table public.seed_signups is
  'Website seed-user list: optional name + email. Insert-only for visitors; read via the dashboard.';

alter table public.seed_signups enable row level security;
alter table public.seed_signups force row level security;

revoke all on public.seed_signups from anon, authenticated;
grant insert on public.seed_signups to anon, authenticated;

drop policy if exists seed_signups_insert_only on public.seed_signups;
create policy seed_signups_insert_only on public.seed_signups
  for insert to anon, authenticated
  with check (true);

commit;
