-- Method import foundation F3: ownership and visibility for private methods.
begin;
alter table public.methods
  add column owner_user_id uuid references auth.users(id) on delete cascade,
  add column hidden_at timestamptz;

create function public.method_visible_to_user(p_method_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.methods m
    where m.id = p_method_id
      and (m.owner_user_id is null or m.owner_user_id = (select auth.uid()))
  )
$$;
revoke all on function public.method_visible_to_user(uuid) from public, anon;
grant execute on function public.method_visible_to_user(uuid) to authenticated;

drop policy methods_authenticated_read on public.methods;
create policy methods_read_shared_or_own on public.methods for select to authenticated
  using (owner_user_id is null or owner_user_id = (select auth.uid()));

drop policy method_releases_authenticated_read_active on public.method_releases;
create policy method_releases_read_active_visible on public.method_releases for select to authenticated
  using (status = 'active' and public.method_visible_to_user(method_id));

drop policy method_splits_authenticated_read_active on public.method_splits;
create policy method_splits_read_active_visible on public.method_splits for select to authenticated
  using (exists (
    select 1 from public.method_releases rel
    where rel.id = method_splits.method_release_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));

drop policy method_rules_authenticated_read_active on public.method_rules;
create policy method_rules_read_active_visible on public.method_rules for select to authenticated
  using (exists (
    select 1 from public.method_releases rel
    where rel.id = method_rules.method_release_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));

drop policy method_split_exercises_authenticated_read_active on public.method_split_exercises;
create policy method_split_exercises_read_active_visible on public.method_split_exercises for select to authenticated
  using (exists (
    select 1 from public.method_splits ms
    join public.method_releases rel on rel.id = ms.method_release_id
    where ms.id = method_split_exercises.method_split_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));

drop policy method_prescription_fields_authenticated_read_active on public.method_prescription_field_values;
create policy method_prescription_fields_read_active_visible on public.method_prescription_field_values for select to authenticated
  using (exists (
    select 1 from public.method_split_exercises mse
    join public.method_splits ms on ms.id = mse.method_split_id
    join public.method_releases rel on rel.id = ms.method_release_id
    where mse.id = method_prescription_field_values.method_split_exercise_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));
commit;
