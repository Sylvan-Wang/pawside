-- Run after all 20260909000xxx Method Phase 1 migrations.

do $test$
declare
  missing_relations text;
begin
  select string_agg(expected_name, ', ' order by expected_name)
  into missing_relations
  from unnest(array[
    'public.method_source_documents',
    'public.method_source_chunks',
    'public.canonical_import_runs',
    'public.method_releases',
    'public.method_rule_sources',
    'public.method_prescription_field_values',
    'public.method_release_issues',
    'public.adaptation_policy_releases',
    'public.adaptation_policies'
  ]) as expected(expected_name)
  where to_regclass(expected_name) is null;

  if missing_relations is not null then
    raise exception 'Missing Method Phase 1 relations: %', missing_relations;
  end if;
end;
$test$;

do $test$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'method_releases_one_active_channel_idx'
  ) then
    raise exception 'Method active release uniqueness index is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.method_releases'::regclass
      and tgname = 'method_releases_validate_activation'
      and not tgisinternal
  ) then
    raise exception 'Method activation gate trigger is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'method_split_exercises'
      and column_name = 'field_provenance'
      and is_nullable = 'NO'
  ) then
    raise exception 'Method field-level provenance column is missing';
  end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'method-release-v1',
  'release_rows', (select count(*) from public.method_releases),
  'active_internal_beta_rows', (
    select count(*) from public.method_releases
    where status = 'active' and release_channel = 'internal_beta'
  ),
  'active_production_rows', (
    select count(*) from public.method_releases
    where status = 'active' and release_channel = 'production'
  )
) as method_release_contract;
