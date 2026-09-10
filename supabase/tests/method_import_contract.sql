-- Schema-level contract for the controlled Canonical importer.

do $test$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'method_rules'
      and column_name = 'source_authority'
  ) then
    raise exception 'method_rules.source_authority is missing';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'method_release_issues'
      and column_name in ('blocks_v1_runtime_release', 'blocks_strict_method_release')
      and is_nullable = 'NO'
  ) <> 2 then
    raise exception 'Dual release blocker contract is missing';
  end if;

  if has_table_privilege('authenticated', 'public.canonical_import_runs', 'INSERT')
     or has_table_privilege('authenticated', 'public.method_releases', 'INSERT')
     or has_table_privilege('authenticated', 'public.method_rules', 'INSERT') then
    raise exception 'Authenticated clients must not write canonical Method release data';
  end if;
end;
$test$;

select jsonb_build_object(
  'contract', 'method-import-v1',
  'runtime_defaults', (
    select count(*) from public.method_prescription_field_values
    where source_authority = 'product_execution_default'
  ),
  'strict_open_issues', (
    select count(*) from public.method_release_issues
    where status <> 'resolved' and blocks_strict_method_release
  )
) as method_import_contract;
