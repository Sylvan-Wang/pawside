-- Method import foundation F2: prevent deletion of enrollments with history.
begin;
create or replace function public.guard_enrollment_delete_with_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.workout_sessions s where s.enrollment_id = old.id)
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'Enrollment % has training history; archive it instead of deleting', old.id
      using errcode = '23503';
  end if;
  return old;
end
$$;

create trigger method_enrollments_guard_delete
  before delete on public.method_enrollments
  for each row execute function public.guard_enrollment_delete_with_history();
revoke all on function public.guard_enrollment_delete_with_history() from public, anon, authenticated;
commit;
