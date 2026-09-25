-- Pawside 2.0 P0-1: explicit exercise skip/resume plus auditable actual invalidation.

begin;

alter table public.workout_sessions
  add column actual_revision integer not null default 0 check (actual_revision >= 0),
  add column downstream_status text not null default 'fresh'
    check (downstream_status in ('fresh', 'pending')),
  add column last_actual_changed_at timestamptz;

create table public.method_actual_change_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  set_execution_id uuid not null references public.set_executions(id) on delete cascade,
  event_kind text not null check (event_kind in ('set_actual_saved', 'set_actual_updated')),
  actual_revision integer not null check (actual_revision > 0),
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index method_actual_change_events_session_idx
  on public.method_actual_change_events(workout_session_id, actual_revision);

alter table public.method_actual_change_events enable row level security;
alter table public.method_actual_change_events force row level security;

create policy method_actual_change_events_select_own on public.method_actual_change_events
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.method_actual_change_events from anon, authenticated;
grant select on table public.method_actual_change_events to authenticated;

create or replace function public.capture_method_actual_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  next_revision integer;
begin
  if new.status <> 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.actual_weight_kg is not distinct from new.actual_weight_kg
     and old.actual_reps is not distinct from new.actual_reps
     and old.actual_rir is not distinct from new.actual_rir
     and old.status is not distinct from new.status then
    return new;
  end if;

  update public.workout_sessions
  set actual_revision = actual_revision + 1,
      downstream_status = 'pending',
      last_actual_changed_at = now()
  where id = new.workout_session_id
  returning actual_revision into next_revision;

  insert into public.method_actual_change_events (
    user_id, workout_session_id, set_execution_id, event_kind,
    actual_revision, before_snapshot, after_snapshot
  ) values (
    new.user_id,
    new.workout_session_id,
    new.id,
    case when tg_op = 'INSERT' or old.status <> 'completed'
      then 'set_actual_saved' else 'set_actual_updated' end,
    next_revision,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'weight_kg', old.actual_weight_kg,
      'reps', old.actual_reps,
      'rir', old.actual_rir,
      'status', old.status
    ) else null end,
    jsonb_build_object(
      'weight_kg', new.actual_weight_kg,
      'reps', new.actual_reps,
      'rir', new.actual_rir,
      'status', new.status
    )
  );

  return new;
end;
$$;

create trigger set_executions_capture_actual_change
after insert or update of actual_weight_kg, actual_reps, actual_rir, status
on public.set_executions
for each row execute function public.capture_method_actual_change();

create or replace function public.set_method_exercise_status(
  p_session_id uuid,
  p_exercise_execution_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_status text;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_action not in ('skip', 'resume') then
    raise exception 'Invalid exercise action' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select execution.status into target_status
  from public.exercise_executions execution
  join public.workout_sessions session on session.id = execution.workout_session_id
  where execution.id = p_exercise_execution_id
    and execution.workout_session_id = p_session_id
    and execution.user_id = current_user_id
    and session.user_id = current_user_id
    and session.status = 'started'
  for update of execution;

  if target_status is null then
    raise exception 'Active exercise execution not found' using errcode = 'P0002';
  end if;

  if p_action = 'skip' then
    if exists (
      select 1 from public.set_executions set_actual
      where set_actual.exercise_execution_id = p_exercise_execution_id
        and set_actual.status = 'completed'
    ) then
      raise exception 'Exercise with completed sets cannot be skipped' using errcode = '55000';
    end if;

    update public.exercise_executions set status = 'skipped'
    where id = p_exercise_execution_id;
    update public.set_executions set status = 'skipped'
    where exercise_execution_id = p_exercise_execution_id and status = 'planned';
  else
    update public.exercise_executions set status = 'not_started'
    where id = p_exercise_execution_id and status = 'skipped';
    update public.set_executions set status = 'planned'
    where exercise_execution_id = p_exercise_execution_id and status = 'skipped';
  end if;

  return jsonb_build_object(
    'exercise_execution_id', p_exercise_execution_id,
    'status', case when p_action = 'skip' then 'skipped' else 'not_started' end,
    'idempotent', (p_action = 'skip' and target_status = 'skipped')
      or (p_action = 'resume' and target_status <> 'skipped')
  );
end;
$$;

revoke all on function public.set_method_exercise_status(uuid, uuid, text) from public, anon;
grant execute on function public.set_method_exercise_status(uuid, uuid, text) to authenticated;

comment on table public.method_actual_change_events is
  'Append-only evidence that a normalized Method set actual changed and downstream projections require recomputation.';

commit;
