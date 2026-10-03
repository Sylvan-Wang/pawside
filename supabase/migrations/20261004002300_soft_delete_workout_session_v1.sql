-- Method import runtime A8: user-authorized soft deletion of a completed method session.
begin;

create function public.soft_delete_workout_session_v1(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not public.feature_enabled('multi_day_runtime') then
    raise exception 'Feature not enabled' using errcode = '42501';
  end if;
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  update public.workout_sessions
  set deleted_at = coalesce(deleted_at, now())
  where id = p_session_id and user_id = current_user_id and status = 'completed';
  return found;
end;
$$;
revoke all on function public.soft_delete_workout_session_v1(uuid) from public, anon;
grant execute on function public.soft_delete_workout_session_v1(uuid) to authenticated;

commit;
