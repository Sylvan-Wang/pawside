-- Pawside 2.0 Phase 1: read-only active Method surfaces for authenticated users.
-- Import, evidence and activation writes remain server/admin-only.

begin;

revoke all on table public.method_source_documents from anon, authenticated;
revoke all on table public.method_source_chunks from anon, authenticated;
revoke all on table public.canonical_import_runs from anon, authenticated;
revoke all on table public.method_releases from anon, authenticated;
revoke all on table public.method_rule_sources from anon, authenticated;
revoke all on table public.method_prescription_field_values from anon, authenticated;
revoke all on table public.method_release_issues from anon, authenticated;
revoke all on table public.adaptation_policy_releases from anon, authenticated;
revoke all on table public.adaptation_policies from anon, authenticated;

grant select on table public.method_releases to authenticated;
grant select on table public.method_rule_sources to authenticated;
grant select on table public.method_prescription_field_values to authenticated;
grant select on table public.adaptation_policy_releases to authenticated;
grant select on table public.adaptation_policies to authenticated;

create policy method_releases_authenticated_read_active
  on public.method_releases for select to authenticated
  using (status = 'active');

create policy method_rule_sources_authenticated_read_active
  on public.method_rule_sources for select to authenticated
  using (
    exists (
      select 1
      from public.method_rules mr
      join public.method_releases rel on rel.id = mr.method_release_id
      where mr.id = method_rule_id and rel.status = 'active'
    )
  );

create policy method_prescription_fields_authenticated_read_active
  on public.method_prescription_field_values for select to authenticated
  using (
    exists (
      select 1
      from public.method_split_exercises mse
      join public.method_splits ms on ms.id = mse.method_split_id
      join public.method_releases rel on rel.id = ms.method_release_id
      where mse.id = method_split_exercise_id and rel.status = 'active'
    )
  );

create policy adaptation_policy_releases_authenticated_read_active
  on public.adaptation_policy_releases for select to authenticated
  using (status = 'active');

create policy adaptation_policies_authenticated_read_active
  on public.adaptation_policies for select to authenticated
  using (
    exists (
      select 1 from public.adaptation_policy_releases rel
      where rel.id = policy_release_id and rel.status = 'active'
    )
  );

drop policy if exists method_splits_authenticated_read on public.method_splits;
create policy method_splits_authenticated_read_active
  on public.method_splits for select to authenticated
  using (
    exists (
      select 1 from public.method_releases rel
      where rel.id = method_release_id and rel.status = 'active'
    )
  );

drop policy if exists method_rules_authenticated_read on public.method_rules;
create policy method_rules_authenticated_read_active
  on public.method_rules for select to authenticated
  using (
    exists (
      select 1 from public.method_releases rel
      where rel.id = method_release_id and rel.status = 'active'
    )
  );

drop policy if exists method_split_exercises_authenticated_read on public.method_split_exercises;
create policy method_split_exercises_authenticated_read_active
  on public.method_split_exercises for select to authenticated
  using (
    exists (
      select 1
      from public.method_splits ms
      join public.method_releases rel on rel.id = ms.method_release_id
      where ms.id = method_split_id and rel.status = 'active'
    )
  );

comment on table public.method_release_issues is
  'Separate V1 runtime blockers from Strict Method source-completion blockers.';

commit;
