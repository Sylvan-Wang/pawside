-- Pawside backend activation hardening.
--
-- This migration follows the legacy compatibility and Method foundation
-- migrations. It aligns the rebuilt database with the fields the current
-- Pawside UI actually writes and makes client privileges explicit.

-- The current body metrics UI writes hip_cm. Preserve data if an earlier
-- compatibility migration created the pluralized hips_cm column.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'body_metrics'
      and column_name = 'hips_cm'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'body_metrics'
      and column_name = 'hip_cm'
  ) then
    alter table public.body_metrics rename column hips_cm to hip_cm;
  end if;
end;
$$;

alter table public.body_metrics
  add column if not exists hip_cm numeric(7,2),
  add column if not exists left_calf_cm numeric(7,2),
  add column if not exists right_calf_cm numeric(7,2);

-- Existing clients intentionally send null when optional JSON sections are
-- empty. Keep the persisted contract compatible with those clients.
alter table public.workout_logs
  alter column exercises drop not null;

alter table public.body_metrics
  alter column custom_metrics drop not null;

alter table public.workout_logs
  add constraint workout_logs_exercises_array_check
  check (exercises is null or jsonb_typeof(exercises) = 'array');

alter table public.food_logs
  add constraint food_logs_foods_array_check
  check (jsonb_typeof(foods) = 'array');

alter table public.body_metrics
  add constraint body_metrics_custom_metrics_object_check
  check (custom_metrics is null or jsonb_typeof(custom_metrics) = 'object');

alter table public.user_profiles
  add constraint user_profiles_preferred_model_check
  check (preferred_model is null or preferred_model in ('openai', 'deepseek'));

comment on column public.body_metrics.hip_cm is
  'Hip circumference in centimetres. This name matches the current Pawside client contract.';
comment on column public.body_metrics.left_calf_cm is
  'Left calf circumference in centimetres.';
comment on column public.body_metrics.right_calf_cm is
  'Right calf circumference in centimetres.';

-- Keep updated_at trustworthy for the normalized food tables that expose it.
create trigger foods_set_updated_at
  before update on public.foods
  for each row execute function public.set_updated_at();
create trigger food_nutrition_set_updated_at
  before update on public.food_nutrition
  for each row execute function public.set_updated_at();
create trigger user_food_logs_set_updated_at
  before update on public.user_food_logs
  for each row execute function public.set_updated_at();
create trigger user_food_log_items_set_updated_at
  before update on public.user_food_log_items
  for each row execute function public.set_updated_at();

alter table public.user_food_logs force row level security;
alter table public.user_food_log_items force row level security;
alter table public.daily_nutrition_summary force row level security;

-- New Auth users always receive the minimum profile shell. An empty
-- search_path prevents object-shadowing inside this security-definer function.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Supabase normally supplies equivalent default privileges. Declaring them in
-- the project migration keeps a fresh rebuild independent of dashboard state.
revoke all privileges on table
  public.user_profiles,
  public.workout_logs,
  public.food_logs,
  public.body_metrics,
  public.weekly_summary,
  public.ai_plans,
  public.ai_generated_content,
  public.user_food_logs,
  public.user_food_log_items,
  public.daily_nutrition_summary,
  public.method_enrollments,
  public.method_cycles,
  public.user_exercise_progression,
  public.session_prescriptions,
  public.exercise_prescriptions,
  public.set_prescriptions
from anon;

grant select, insert, update, delete on table
  public.user_profiles,
  public.workout_logs,
  public.food_logs,
  public.body_metrics,
  public.weekly_summary,
  public.ai_plans,
  public.ai_generated_content,
  public.user_food_logs,
  public.user_food_log_items,
  public.daily_nutrition_summary
to authenticated;

grant select on table
  public.method_enrollments,
  public.method_cycles,
  public.user_exercise_progression,
  public.session_prescriptions,
  public.exercise_prescriptions,
  public.set_prescriptions
to authenticated;

revoke insert, update, delete on table
  public.foods,
  public.food_aliases,
  public.food_nutrition,
  public.food_portion_templates
from anon, authenticated;

grant select on table
  public.foods,
  public.food_aliases,
  public.food_nutrition,
  public.food_portion_templates
to anon, authenticated;

revoke all privileges on table
  public.methods,
  public.method_splits,
  public.exercises,
  public.exercise_media,
  public.exercise_external_mappings,
  public.method_rules,
  public.method_split_exercises
from anon;

revoke insert, update, delete on table
  public.methods,
  public.method_splits,
  public.exercises,
  public.exercise_media,
  public.exercise_external_mappings,
  public.method_rules,
  public.method_split_exercises
from authenticated;

grant select on table
  public.methods,
  public.method_splits,
  public.exercises,
  public.exercise_media,
  public.exercise_external_mappings,
  public.method_rules,
  public.method_split_exercises
to authenticated;
