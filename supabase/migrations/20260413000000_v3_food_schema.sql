-- V3 Food Schema Migration
-- Creates the structured food database for deterministic nutrition calculation
-- Architecture: structured DB + rule engine + AI parse layer

-- ============================================================
-- 1. foods — canonical food reference table
-- ============================================================
create table if not exists foods (
  id          serial primary key,
  canonical_name text not null unique,
  category    text,
  subcategory text,
  default_unit text not null default 'g',
  density_g_per_ml numeric(10,4),
  edible_portion_ratio numeric(10,4) default 1.0,
  source      text default 'China Food Composition Table',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists foods_canonical_name_idx on foods (canonical_name);
create index if not exists foods_category_idx on foods (category);

-- ============================================================
-- 2. food_aliases — alias / synonym lookup table
-- ============================================================
create table if not exists food_aliases (
  id          serial primary key,
  food_id     integer not null references foods(id) on delete cascade,
  alias       text not null,
  alias_type  text not null default 'synonym',  -- synonym | brand | colloquial
  created_at  timestamptz not null default now(),
  unique(food_id, alias)
);

create index if not exists food_aliases_alias_idx on food_aliases (alias);
create index if not exists food_aliases_food_id_idx on food_aliases (food_id);

-- ============================================================
-- 3. food_nutrition — per-100g nutrition values
-- ============================================================
create table if not exists food_nutrition (
  id               serial primary key,
  food_id          integer not null references foods(id) on delete cascade unique,
  basis_type       text not null default 'per_100g',
  energy_kcal      numeric(10,2),
  protein_g        numeric(10,2),
  fat_g            numeric(10,2),
  carb_g           numeric(10,2),
  fiber_g          numeric(10,2),
  sodium_mg        numeric(10,2),
  data_version     text default 'v1',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists food_nutrition_food_id_idx on food_nutrition (food_id);

-- ============================================================
-- 4. food_portion_templates — "1 egg = 50g" lookup
-- ============================================================
create table if not exists food_portion_templates (
  id           serial primary key,
  food_id      integer not null references foods(id) on delete cascade,
  portion_name text not null,   -- e.g. "1个", "1碗", "1杯"
  weight_g     numeric(10,2) not null,
  note         text,
  created_at   timestamptz not null default now(),
  unique(food_id, portion_name)
);

create index if not exists food_portion_templates_food_id_idx on food_portion_templates (food_id);

-- ============================================================
-- 5. user_food_logs — one row per meal session
-- ============================================================
create table if not exists user_food_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  log_date       date not null,
  meal_type      text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  input_mode     text not null default 'manual' check (input_mode in ('manual','natural_language','ai_assisted')),
  raw_input_text text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists user_food_logs_user_date_idx on user_food_logs (user_id, log_date);

-- ============================================================
-- 6. user_food_log_items — one row per food item in a meal
-- ============================================================
create table if not exists user_food_log_items (
  id                  uuid primary key default gen_random_uuid(),
  food_log_id         uuid not null references user_food_logs(id) on delete cascade,
  food_id             integer references foods(id),
  food_name_raw       text not null,
  food_name_resolved  text,
  weight_g            numeric(10,2),
  quantity            numeric(10,2),
  unit                text,
  is_estimated        boolean not null default false,
  confidence          numeric(5,4),
  -- Computed nutrition values (formula: per_100g * weight_g / 100)
  energy_kcal         numeric(10,2),
  protein_g           numeric(10,2),
  fat_g               numeric(10,2),
  carb_g              numeric(10,2),
  -- Audit trail for recalculation
  calculation_basis   jsonb,
  status              text not null default 'confirmed' check (status in ('draft','confirmed','rejected')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists user_food_log_items_log_id_idx on user_food_log_items (food_log_id);
create index if not exists user_food_log_items_food_id_idx on user_food_log_items (food_id);

-- ============================================================
-- 7. daily_nutrition_summary — cached daily totals per user
-- ============================================================
create table if not exists daily_nutrition_summary (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  log_date           date not null,
  total_energy_kcal  numeric(10,2) not null default 0,
  total_protein_g    numeric(10,2) not null default 0,
  total_fat_g        numeric(10,2) not null default 0,
  total_carb_g       numeric(10,2) not null default 0,
  meal_count         integer not null default 0,
  updated_at         timestamptz not null default now(),
  unique(user_id, log_date)
);

create index if not exists daily_nutrition_summary_user_date_idx on daily_nutrition_summary (user_id, log_date);

-- ============================================================
-- RLS policies — users can only access their own logs
-- ============================================================
alter table user_food_logs enable row level security;
alter table user_food_log_items enable row level security;
alter table daily_nutrition_summary enable row level security;

-- user_food_logs
create policy "users can manage own food logs"
  on user_food_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_food_log_items (access via food_log ownership)
create policy "users can manage own food log items"
  on user_food_log_items for all
  using (
    exists (
      select 1 from user_food_logs
      where id = user_food_log_items.food_log_id
        and user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from user_food_logs
      where id = user_food_log_items.food_log_id
        and user_id = auth.uid()
    )
  );

-- daily_nutrition_summary
create policy "users can manage own nutrition summary"
  on daily_nutrition_summary for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- foods, food_aliases, food_nutrition, food_portion_templates are public read
alter table foods enable row level security;
alter table food_aliases enable row level security;
alter table food_nutrition enable row level security;
alter table food_portion_templates enable row level security;

create policy "foods are publicly readable"
  on foods for select using (true);

create policy "food_aliases are publicly readable"
  on food_aliases for select using (true);

create policy "food_nutrition is publicly readable"
  on food_nutrition for select using (true);

create policy "food_portion_templates are publicly readable"
  on food_portion_templates for select using (true);
