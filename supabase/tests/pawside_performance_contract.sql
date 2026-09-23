-- Run after 20260907000100_pawside_performance_advisor_hardening.sql.
-- This checks the intended database shape. It does not claim a measured
-- latency improvement, which requires representative production workload data.

do $contract$
declare
  missing_indexes text[];
  invalid_policies text[];
begin
  select array_agg(expected_name order by expected_name)
    into missing_indexes
  from (
    values
      ('exercise_media_exercise_id_idx'),
      ('exercise_prescriptions_exercise_id_idx'),
      ('method_enrollments_method_id_idx'),
      ('method_split_exercises_exercise_id_idx'),
      ('session_prescriptions_cycle_id_idx'),
      ('session_prescriptions_method_split_id_idx'),
      ('user_exercise_progression_exercise_id_idx')
  ) as expected(expected_name)
  where not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = expected.expected_name
  );

  if missing_indexes is not null then
    raise exception 'Missing Pawside performance indexes: %', missing_indexes;
  end if;

  select array_agg(expected_name order by expected_name)
    into invalid_policies
  from (
    values
      ('user_food_logs', 'users can manage own food logs'),
      ('user_food_log_items', 'users can manage own food log items'),
      ('daily_nutrition_summary', 'users can manage own nutrition summary')
  ) as expected(table_name, expected_name)
  where not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = expected.table_name
      and policyname = expected.expected_name
      and coalesce(qual, '') ~* 'select[[:space:]]+auth[.]uid[(][)]'
      and coalesce(with_check, '') ~* 'select[[:space:]]+auth[.]uid[(][)]'
  );

  if invalid_policies is not null then
    raise exception 'Missing or non-optimized Pawside food policies: %', invalid_policies;
  end if;
end
$contract$;

select
  'pawside performance contract passed' as result,
  7 as verified_foreign_key_indexes,
  3 as verified_rls_policies;
