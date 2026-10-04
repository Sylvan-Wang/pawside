-- Method import B2/A2 integration: preserve optional set ranges without rewriting earlier migrations.
begin;
alter table public.method_runtime_set_templates add column is_optional boolean not null default false;
alter table public.set_prescriptions add column is_optional boolean not null default false;

create function public.copy_runtime_set_optional_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select coalesce(template.is_optional, false) into new.is_optional
  from public.exercise_prescriptions ep
  join public.session_prescriptions sp on sp.id = ep.session_prescription_id
  join public.method_split_exercises mse
    on mse.method_split_id = sp.method_split_id and mse.exercise_id = ep.exercise_id
  join public.method_rules rule
    on rule.method_release_id = sp.method_release_id and rule.rule_key = mse.prescription_rule_key
  join public.method_runtime_set_templates template
    on template.method_rule_id = rule.id and template.set_index = new.set_index
  where ep.id = new.exercise_prescription_id;
  new.is_optional := coalesce(new.is_optional, false);
  return new;
end;
$$;
create trigger set_prescriptions_copy_optional
  before insert on public.set_prescriptions
  for each row execute function public.copy_runtime_set_optional_flag();
revoke all on function public.copy_runtime_set_optional_flag() from public, anon, authenticated;

create function public.complete_method_session_v4(
  p_session_id uuid,
  p_completion_request_id uuid,
  p_duration_minutes integer default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.workout_sessions ws
    where ws.id = p_session_id and ws.user_id = auth.uid() and ws.deleted_at is null
  ) then raise exception 'Training session not found' using errcode = 'P0002'; end if;
  delete from public.set_prescriptions plan
  using public.exercise_executions execution
  where execution.workout_session_id = p_session_id
    and execution.exercise_prescription_id = plan.exercise_prescription_id
    and plan.is_optional
    and not exists (
      select 1 from public.set_executions actual
      where actual.exercise_execution_id = execution.id
        and actual.set_prescription_id = plan.id
        and actual.status = 'completed'
    );
  return public.complete_method_session_v3(p_session_id, p_completion_request_id, p_duration_minutes, p_notes);
end;
$$;
revoke all on function public.complete_method_session_v4(uuid, uuid, integer, text) from public, anon;
grant execute on function public.complete_method_session_v4(uuid, uuid, integer, text) to authenticated;
commit;
