-- Run after 20260910000100_method_enrollment_foundation.sql.

do $test$
begin
  if to_regclass('public.onboarding_capability_profiles') is null then
    raise exception 'onboarding_capability_profiles is missing';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'method_enrollments'
      and column_name in (
        'method_release_id',
        'capability_profile_id',
        'adaptation_policy_release_id',
        'pause_reason',
        'paused_at',
        'resumed_at'
      )
  ) <> 6 then
    raise exception 'Phase 2 enrollment pin/pause columns are incomplete';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.method_enrollments'::regclass
      and conname = 'method_enrollments_active_release_pin_check'
  ) then
    raise exception 'Active enrollment release-pin check is missing';
  end if;

  if has_table_privilege('authenticated', 'public.method_enrollments', 'INSERT')
     or has_table_privilege('authenticated', 'public.method_cycles', 'INSERT') then
    raise exception 'Authenticated clients must not directly create enrollment or cycle rows';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.initialize_current_method_enrollment()',
    'EXECUTE'
  ) then
    raise exception 'Authenticated enrollment RPC access is missing';
  end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'method-enrollment-phase2',
  'capability_profiles', (select count(*) from public.onboarding_capability_profiles),
  'release_pinned_enrollments', (
    select count(*) from public.method_enrollments where method_release_id is not null
  ),
  'unbound_active_enrollments', (
    select count(*) from public.method_enrollments
    where status = 'active' and method_release_id is null
  )
) as method_enrollment_contract;
