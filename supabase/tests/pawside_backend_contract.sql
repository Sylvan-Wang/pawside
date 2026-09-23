-- Pawside backend contract verification.
-- Run after all migrations. This script is read-only and fails fast when the
-- fresh Supabase project does not match the current Pawside application.

do $test$
declare
  missing_relations text;
begin
  select string_agg(expected_name, ', ' order by expected_name)
  into missing_relations
  from unnest(array[
    'public.foods',
    'public.food_aliases',
    'public.food_nutrition',
    'public.food_portion_templates',
    'public.user_food_logs',
    'public.user_food_log_items',
    'public.daily_nutrition_summary',
    'public.user_profiles',
    'public.workout_logs',
    'public.food_logs',
    'public.body_metrics',
    'public.weekly_summary',
    'public.ai_plans',
    'public.ai_generated_content',
    'public.methods',
    'public.method_splits',
    'public.exercises',
    'public.exercise_media',
    'public.exercise_external_mappings',
    'public.method_rules',
    'public.method_split_exercises',
    'public.method_enrollments',
    'public.method_cycles',
    'public.user_exercise_progression',
    'public.session_prescriptions',
    'public.exercise_prescriptions',
    'public.set_prescriptions',
    'public.method_source_documents',
    'public.method_source_chunks',
    'public.canonical_import_runs',
    'public.method_releases',
    'public.method_rule_sources',
    'public.method_prescription_field_values',
    'public.method_release_issues',
    'public.adaptation_policy_releases',
    'public.adaptation_policies',
    'public.onboarding_capability_profiles'
  ]) as expected(expected_name)
  where to_regclass(expected_name) is null;

  if missing_relations is not null then
    raise exception 'Missing Pawside relations: %', missing_relations;
  end if;
end;
$test$;

do $test$
declare
  missing_columns text;
begin
  with expected(table_name, column_name) as (
    values
      ('user_profiles', 'id'),
      ('user_profiles', 'email'),
      ('user_profiles', 'gender'),
      ('user_profiles', 'height_cm'),
      ('user_profiles', 'reference_weight_kg'),
      ('user_profiles', 'weight_kg'),
      ('user_profiles', 'weight_unit'),
      ('user_profiles', 'goal'),
      ('user_profiles', 'weekly_workout_target'),
      ('user_profiles', 'daily_calorie_target'),
      ('user_profiles', 'preferred_model'),
      ('user_profiles', 'onboarding_completed'),
      ('workout_logs', 'date'),
      ('workout_logs', 'type'),
      ('workout_logs', 'duration_minutes'),
      ('workout_logs', 'notes'),
      ('workout_logs', 'exercises'),
      ('food_logs', 'date'),
      ('food_logs', 'meal_type'),
      ('food_logs', 'foods'),
      ('body_metrics', 'date'),
      ('body_metrics', 'weight_kg'),
      ('body_metrics', 'body_fat_pct'),
      ('body_metrics', 'muscle_mass'),
      ('body_metrics', 'chest_cm'),
      ('body_metrics', 'waist_cm'),
      ('body_metrics', 'hip_cm'),
      ('body_metrics', 'left_arm_cm'),
      ('body_metrics', 'right_arm_cm'),
      ('body_metrics', 'left_thigh_cm'),
      ('body_metrics', 'right_thigh_cm'),
      ('body_metrics', 'left_calf_cm'),
      ('body_metrics', 'right_calf_cm'),
      ('body_metrics', 'custom_metrics'),
      ('ai_generated_content', 'content_type'),
      ('ai_generated_content', 'target_date'),
      ('ai_generated_content', 'content_json'),
      ('ai_generated_content', 'content_text'),
      ('ai_generated_content', 'prompt_version'),
      ('ai_generated_content', 'feedback')
  )
  select string_agg(format('public.%I.%I', e.table_name, e.column_name), ', ' order by e.table_name, e.column_name)
  into missing_columns
  from expected e
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = e.table_name
   and c.column_name = e.column_name
  where c.column_name is null;

  if missing_columns is not null then
    raise exception 'Missing Pawside columns: %', missing_columns;
  end if;
end;
$test$;

do $test$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workout_logs'
      and column_name = 'exercises'
      and is_nullable <> 'YES'
  ) then
    raise exception 'workout_logs.exercises must accept the null emitted by the current client';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'body_metrics'
      and column_name = 'custom_metrics'
      and is_nullable <> 'YES'
  ) then
    raise exception 'body_metrics.custom_metrics must accept the null emitted by the current client';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_generated_content'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(user_id, content_type, target_date)%'
  ) then
    raise exception 'ai_generated_content cache key is missing';
  end if;
end;
$test$;

do $test$
declare
  rls_missing text;
begin
  with expected(relname) as (
    select unnest(array[
      'user_profiles',
      'workout_logs',
      'food_logs',
      'body_metrics',
      'weekly_summary',
      'ai_plans',
      'ai_generated_content',
      'user_food_logs',
      'user_food_log_items',
      'daily_nutrition_summary',
      'method_enrollments',
      'onboarding_capability_profiles',
      'method_cycles',
      'user_exercise_progression',
      'session_prescriptions',
      'exercise_prescriptions',
      'set_prescriptions'
    ])
  )
  select string_agg(e.relname, ', ' order by e.relname)
  into rls_missing
  from expected e
  join pg_class c on c.relname = e.relname
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where not c.relrowsecurity;

  if rls_missing is not null then
    raise exception 'RLS is disabled on user-owned tables: %', rls_missing;
  end if;
end;
$test$;

do $test$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'auth.users'::regclass
      and t.tgname = 'on_auth_user_created'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and n.nspname = 'public'
      and p.proname = 'handle_new_user'
  ) then
    raise exception 'Auth user profile trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'handle_new_user'
      and p.prosecdef
  ) then
    raise exception 'handle_new_user must remain SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'user_profiles_select_own'
  ) then
    raise exception 'user_profiles ownership policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workout_logs'
      and policyname = 'workout_logs_manage_own'
  ) then
    raise exception 'workout_logs ownership policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'food_logs'
      and policyname = 'food_logs_manage_own'
  ) then
    raise exception 'food_logs ownership policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'body_metrics'
      and policyname = 'body_metrics_manage_own'
  ) then
    raise exception 'body_metrics ownership policy is missing';
  end if;

  if has_table_privilege('anon', 'public.user_profiles', 'SELECT')
     or has_table_privilege('anon', 'public.workout_logs', 'SELECT')
     or has_table_privilege('anon', 'public.food_logs', 'SELECT')
     or has_table_privilege('anon', 'public.body_metrics', 'SELECT') then
    raise exception 'anon still has direct privileges on private Pawside tables';
  end if;
end;
$test$;

do $test$
declare
  method_status text;
begin
  select status
  into method_status
  from public.methods
  where key = 'ksw_tcy_three_split_2026'
    and version = '1.0';

  if method_status is null then
    raise exception 'Pawside Method structural seed is missing';
  end if;

  raise notice 'Pawside Method status: %', method_status;
  if method_status <> 'active' then
    raise notice 'Method execution remains intentionally unavailable until authoritative rules are loaded';
  end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'pawside-backend-2026-09-06',
  'food_reference_rows', (select count(*) from public.foods),
  'food_nutrition_rows', (select count(*) from public.food_nutrition),
  'method_status', (
    select status
    from public.methods
    where key = 'ksw_tcy_three_split_2026'
      and version = '1.0'
  ),
  'auth_profile_trigger', 'verified',
  'private_table_rls', 'verified'
) as pawside_backend_verification;
