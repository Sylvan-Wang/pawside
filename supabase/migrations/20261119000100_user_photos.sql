-- =============================================================================
-- User photo album (小爪上传照片 + 我的 → 相册)
-- =============================================================================
--
-- Additive only.
--
--   1. public.user_photos  one row per stored image, owned by the user.
--        category: body (身体记录) / meal (饮食) / poster (报告海报) / other (其他)
--        source:   chat (uploaded in 小爪) / album (uploaded on the album page)
--                  / report (a poster a report generated)
--   2. private Storage bucket `user-photos`, objects at `<user_id>/<file>`,
--      with policies that let a signed-in user touch only their own folder.
--
-- Photos are stored and shown back to their owner only. Nothing here sends a
-- photo to any AI model; 小爪 does not read photo content.
--
-- Account deletion removes the Storage objects first (app/api/account/delete),
-- then the auth user, which cascades through user_photos. Clearing a chat
-- leaves the photos in the album (conversation_id is set to null).
--
-- The Storage half only runs where the `storage` schema exists, so the local
-- Postgres stand-in (scripts/local-supabase, no Storage) still applies every
-- migration.
-- =============================================================================

begin;

create table public.user_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('body', 'meal', 'poster', 'other')),
  source text not null check (source in ('chat', 'album', 'report')),
  -- Set for photos sent in 小爪, so the chat can show them in place.
  conversation_id uuid references public.coach_conversations(id) on delete set null,
  -- `<user_id>/<uuid>.<ext>` inside the `user-photos` bucket.
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  -- The user's calendar date when the photo was added (grouping in the album).
  local_date date not null,
  note text check (note is null or char_length(note) <= 200),
  -- A retried upload with the same id returns the first row instead of a copy.
  client_request_id uuid,
  created_at timestamptz not null default now(),
  constraint user_photos_path_owner check (split_part(storage_path, '/', 1) = user_id::text),
  constraint user_photos_report_is_poster check (source <> 'report' or category = 'poster')
);

create unique index user_photos_client_request_idx
  on public.user_photos (user_id, client_request_id)
  where client_request_id is not null;
create index user_photos_user_category_idx
  on public.user_photos (user_id, category, created_at desc);
create index user_photos_user_created_idx
  on public.user_photos (user_id, created_at desc);
create index user_photos_conversation_idx
  on public.user_photos (conversation_id, created_at)
  where conversation_id is not null;

alter table public.user_photos enable row level security;
alter table public.user_photos force row level security;

create policy user_photos_select_own on public.user_photos
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_photos_insert_own on public.user_photos
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      conversation_id is null
      or exists (
        select 1 from public.coach_conversations c
        where c.id = conversation_id and c.user_id = (select auth.uid())
      )
    )
  );

create policy user_photos_update_own on public.user_photos
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_photos_delete_own on public.user_photos
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Supabase default privileges grant everything to authenticated; take that back first.
revoke all on table public.user_photos from public, anon, authenticated;
grant select, insert, delete on table public.user_photos to authenticated;
-- Only the label and note can change after upload; the file, owner and source cannot.
grant update (category, note) on table public.user_photos to authenticated;

-- Storage bucket and its policies ---------------------------------------------

do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present; skipping user-photos bucket (local stand-in)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('user-photos', 'user-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists user_photos_objects_select on storage.objects;
  drop policy if exists user_photos_objects_insert on storage.objects;
  drop policy if exists user_photos_objects_delete on storage.objects;

  create policy user_photos_objects_select on storage.objects
    for select to authenticated
    using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

  create policy user_photos_objects_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

  create policy user_photos_objects_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
end
$storage$;

commit;
