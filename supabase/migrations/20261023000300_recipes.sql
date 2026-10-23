-- =============================================================================
-- Recipe recommendations (小爪 → 推荐食谱)
-- =============================================================================
-- Additive only. A recipe is a POINTER to someone else's video (link + title +
-- a few tags). Pawside stores no video, no cover image, and never writes numbers
-- the source did not state.
--
--   * Every imported row starts as 'draft'. Users can only ever read rows that are
--     'published' AND whose feature key `recipes` is on for them (RLS below).
--   * kcal_claimed is what the video title/author CLAIMS. kcal_basis says what that
--     number is about ('unspecified' until someone checks). It is never used in any
--     calculation, only shown as "视频标称".
--   * protein/carb/fat stay NULL until a trustworthy source exists. Nothing guesses them.
--   * Writes happen only with the service role / SQL editor (no write policies).
-- =============================================================================

begin;

insert into public.app_features (key, note) values
  ('recipes', '小爪推荐食谱（只推荐已发布的、链接到原视频的食谱）')
on conflict (key) do nothing;

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  recipe_code text not null unique,
  title text not null check (length(title) between 1 and 200),
  bv_id text unique check (bv_id is null or bv_id ~ '^BV[0-9A-Za-z]{10}$'),
  source_url text not null check (source_url ~ '^https://www\.bilibili\.com/video/BV[0-9A-Za-z]{10}/?$'),
  up_name_raw text,
  up_verified boolean not null default false,
  series text,
  summary text,
  ingredients text[] not null default '{}',
  dish_kind text,
  goal_tags_raw text[] not null default '{}',
  kcal_claimed integer check (kcal_claimed is null or kcal_claimed between 1 and 5000),
  kcal_basis text not null default 'unspecified'
    check (kcal_basis in ('unspecified', 'unknown', 'day', 'per_serving', 'per_meal')),
  protein_g numeric check (protein_g is null or protein_g >= 0),
  carb_g numeric check (carb_g is null or carb_g >= 0),
  fat_g numeric check (fat_g is null or fat_g >= 0),
  minutes integer check (minutes is null or minutes between 1 and 600),
  evidence_level text not null default 'second_hand_ai',
  verify_note text,
  search_text text not null default '',
  status text not null default 'draft' check (status in ('draft', 'verified', 'published', 'retired')),
  verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a published recipe has been looked at by a person
  constraint recipes_published_needs_verification check (status <> 'published' or verified_at is not null)
);

create index recipes_status_idx on public.recipes (status);

alter table public.recipes enable row level security;

create policy recipes_read_published on public.recipes
  for select to authenticated
  using (status = 'published' and public.feature_enabled('recipes'));

revoke all on public.recipes from public, anon, authenticated;
grant select on public.recipes to authenticated;

comment on table public.recipes is
  'Pointers to third-party recipe videos. Default draft; only published rows are readable, and only with feature key recipes. kcal_claimed is the source''s claim, never used in calculations.';

commit;
