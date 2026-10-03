-- Method import foundation F3: data-driven program-day rotation and display names.
begin;
create function public.next_program_day(p_cycle_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select split.key
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  join public.method_splits split on split.method_release_id = enrollment.method_release_id
  where cycle.id = p_cycle_id
    and split.is_required
    and not exists (
      select 1 from public.session_prescriptions prescription
      where prescription.cycle_id = cycle.id
        and prescription.split_key = split.key
        and prescription.status in ('completed', 'skipped')
    )
  order by split.order_index
  limit 1
$$;
revoke all on function public.next_program_day(uuid) from public, anon, authenticated;

create function public.workout_log_type_for_split(p_enrollment_id uuid, p_split_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select split.name_zh
  from public.method_enrollments enrollment
  join public.method_splits split on split.method_release_id = enrollment.method_release_id
  where enrollment.id = p_enrollment_id and split.key = p_split_key
$$;
revoke all on function public.workout_log_type_for_split(uuid, text) from public, anon, authenticated;
commit;
