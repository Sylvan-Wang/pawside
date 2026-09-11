-- Pawside 2.0 Phase 2: normalized Method workout actuals and the
-- transactional Push -> Pull -> Legs -> next-cycle state machine.

begin;

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_prescription_id uuid not null unique references public.session_prescriptions(id) on delete restrict,
  enrollment_id uuid not null references public.method_enrollments(id) on delete cascade,
  cycle_id uuid not null references public.method_cycles(id) on delete restrict,
  split_key text not null check (split_key in ('push', 'pull', 'legs')),
  status text not null default 'started' check (status in ('started', 'completed')),
  log_date date not null default current_date,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed' and completed_at is not null) or status = 'started')
);

create table public.exercise_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_prescription_id uuid not null references public.exercise_prescriptions(id) on delete restrict,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  order_index integer not null check (order_index > 0),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workout_session_id, exercise_prescription_id),
  unique(workout_session_id, order_index)
);

create table public.set_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_execution_id uuid not null references public.exercise_executions(id) on delete cascade,
  set_prescription_id uuid references public.set_prescriptions(id) on delete set null,
  set_index integer not null check (set_index > 0),
  actual_weight_kg numeric(7,3) check (actual_weight_kg is null or actual_weight_kg >= 0),
  actual_reps integer check (actual_reps is null or actual_reps >= 0),
  actual_rir numeric(4,2) check (actual_rir is null or actual_rir between 0 and 20),
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  is_extra boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(exercise_execution_id, set_index),
  check ((status = 'completed' and actual_reps is not null and completed_at is not null) or status <> 'completed')
);

create index workout_sessions_user_date_idx on public.workout_sessions(user_id, log_date desc);
create index workout_sessions_enrollment_cycle_idx on public.workout_sessions(enrollment_id, cycle_id);
create index exercise_executions_session_idx on public.exercise_executions(workout_session_id, order_index);
create index set_executions_session_idx on public.set_executions(workout_session_id, exercise_execution_id, set_index);

alter table public.workout_logs
  add column method_workout_session_id uuid unique references public.workout_sessions(id) on delete set null;

alter table public.method_cycles
  add constraint method_cycles_push_session_fk foreign key (push_session_id) references public.workout_sessions(id) not valid,
  add constraint method_cycles_pull_session_fk foreign key (pull_session_id) references public.workout_sessions(id) not valid,
  add constraint method_cycles_legs_session_fk foreign key (legs_session_id) references public.workout_sessions(id) not valid;

alter table public.method_cycles validate constraint method_cycles_push_session_fk;
alter table public.method_cycles validate constraint method_cycles_pull_session_fk;
alter table public.method_cycles validate constraint method_cycles_legs_session_fk;

alter table public.workout_sessions enable row level security;
alter table public.workout_sessions force row level security;
alter table public.exercise_executions enable row level security;
alter table public.exercise_executions force row level security;
alter table public.set_executions enable row level security;
alter table public.set_executions force row level security;

create policy workout_sessions_select_own on public.workout_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy exercise_executions_select_own on public.exercise_executions
  for select to authenticated using (user_id = (select auth.uid()));
create policy set_executions_select_own on public.set_executions
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.workout_sessions, public.exercise_executions, public.set_executions from anon, authenticated;
grant select on table public.workout_sessions, public.exercise_executions, public.set_executions to authenticated;

create trigger workout_sessions_set_updated_at before update on public.workout_sessions
  for each row execute function public.set_updated_at();
create trigger exercise_executions_set_updated_at before update on public.exercise_executions
  for each row execute function public.set_updated_at();
create trigger set_executions_set_updated_at before update on public.set_executions
  for each row execute function public.set_updated_at();

create or replace function public.start_method_session(p_prescription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_prescription record;
  existing_session_id uuid;
  created_session_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_prescription_id::text, 0));

  select prescription.user_id, prescription.enrollment_id, prescription.cycle_id,
         prescription.split_key, prescription.status
  into target_prescription
  from public.session_prescriptions prescription
  where prescription.id = p_prescription_id
  for update;

  if target_prescription.user_id is null or target_prescription.user_id <> current_user_id then
    raise exception 'Training prescription not found' using errcode = 'P0002';
  end if;

  select session.id into existing_session_id
  from public.workout_sessions session
  where session.session_prescription_id = p_prescription_id;

  if existing_session_id is not null then
    return jsonb_build_object('session_id', existing_session_id, 'status', target_prescription.status, 'idempotent', true);
  end if;

  if target_prescription.cycle_id is null
     or target_prescription.status not in ('ready', 'upcoming', 'rest_deferred') then
    raise exception 'Training prescription cannot be started' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.method_enrollments enrollment
    where enrollment.id = target_prescription.enrollment_id
      and enrollment.user_id = current_user_id
      and enrollment.status = 'active'
      and enrollment.next_split_key = target_prescription.split_key
  ) then
    raise exception 'Training prescription is not the current split' using errcode = '55000';
  end if;

  insert into public.workout_sessions (
    user_id, session_prescription_id, enrollment_id, cycle_id, split_key, status
  ) values (
    current_user_id, p_prescription_id, target_prescription.enrollment_id,
    target_prescription.cycle_id, target_prescription.split_key, 'started'
  ) returning id into created_session_id;

  insert into public.exercise_executions (
    user_id, workout_session_id, exercise_prescription_id, exercise_id, order_index
  )
  select current_user_id, created_session_id, prescription.id,
         prescription.exercise_id, prescription.order_index
  from public.exercise_prescriptions prescription
  where prescription.session_prescription_id = p_prescription_id
  order by prescription.order_index;

  insert into public.set_executions (
    user_id, workout_session_id, exercise_execution_id, set_prescription_id,
    set_index, status, is_extra
  )
  select current_user_id, created_session_id, execution.id, set_plan.id,
         set_plan.set_index, 'planned', false
  from public.exercise_executions execution
  join public.set_prescriptions set_plan
    on set_plan.exercise_prescription_id = execution.exercise_prescription_id
  where execution.workout_session_id = created_session_id;

  update public.session_prescriptions
  set status = 'started', started_at = coalesce(started_at, now())
  where id = p_prescription_id;

  update public.method_enrollments
  set current_state = 'session_in_progress'
  where id = target_prescription.enrollment_id;

  return jsonb_build_object('session_id', created_session_id, 'status', 'started', 'idempotent', false);
end;
$$;

create or replace function public.save_method_set_actual(
  p_session_id uuid,
  p_exercise_execution_id uuid,
  p_set_index integer,
  p_actual_weight_kg numeric,
  p_actual_reps integer,
  p_actual_rir numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_exercise_prescription_id uuid;
  target_set_prescription_id uuid;
  target_set_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_set_index < 1 or p_set_index > 50 or p_actual_reps < 0
     or p_actual_weight_kg < 0 or p_actual_rir < 0 or p_actual_rir > 20 then
    raise exception 'Invalid set actual' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select execution.exercise_prescription_id
  into target_exercise_prescription_id
  from public.exercise_executions execution
  join public.workout_sessions session on session.id = execution.workout_session_id
  where execution.id = p_exercise_execution_id
    and execution.workout_session_id = p_session_id
    and execution.user_id = current_user_id
    and session.user_id = current_user_id
    and session.status = 'started';

  if target_exercise_prescription_id is null then
    raise exception 'Active exercise execution not found' using errcode = 'P0002';
  end if;

  select set_plan.id into target_set_prescription_id
  from public.set_prescriptions set_plan
  where set_plan.exercise_prescription_id = target_exercise_prescription_id
    and set_plan.set_index = p_set_index;

  insert into public.set_executions (
    user_id, workout_session_id, exercise_execution_id, set_prescription_id,
    set_index, actual_weight_kg, actual_reps, actual_rir, status, is_extra, completed_at
  ) values (
    current_user_id, p_session_id, p_exercise_execution_id, target_set_prescription_id,
    p_set_index, p_actual_weight_kg, p_actual_reps, p_actual_rir, 'completed',
    target_set_prescription_id is null, now()
  )
  on conflict (exercise_execution_id, set_index) do update set
    actual_weight_kg = excluded.actual_weight_kg,
    actual_reps = excluded.actual_reps,
    actual_rir = excluded.actual_rir,
    status = 'completed',
    is_extra = excluded.is_extra,
    completed_at = excluded.completed_at
  returning id into target_set_id;

  update public.exercise_executions
  set status = 'in_progress'
  where id = p_exercise_execution_id and status = 'not_started';

  return jsonb_build_object('set_execution_id', target_set_id, 'status', 'completed');
end;
$$;

create or replace function public.complete_method_session(
  p_session_id uuid,
  p_duration_minutes integer default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_session record;
  completed_set_count integer;
  actual_duration integer;
  next_split text;
  next_cycle_number integer;
  next_prescription_id uuid;
  new_cycle_id uuid;
  legacy_exercises jsonb;
  did_complete_cycle boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select session.id, session.user_id, session.session_prescription_id,
         session.enrollment_id, session.cycle_id, session.split_key,
         session.status, session.started_at
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id
  for update;

  if target_session.user_id is null or target_session.user_id <> current_user_id then
    raise exception 'Training session not found' using errcode = 'P0002';
  end if;

  if target_session.status = 'completed' then
    select enrollment.next_split_key, enrollment.current_cycle_number
    into next_split, next_cycle_number
    from public.method_enrollments enrollment
    where enrollment.id = target_session.enrollment_id;
    return jsonb_build_object(
      'session_id', p_session_id, 'status', 'completed', 'idempotent', true,
      'next_split_key', next_split, 'current_cycle_number', next_cycle_number
    );
  end if;

  select count(*) into completed_set_count
  from public.set_executions set_actual
  where set_actual.workout_session_id = p_session_id
    and set_actual.status = 'completed';

  if completed_set_count = 0 then
    raise exception 'At least one completed set is required' using errcode = '22023';
  end if;

  actual_duration := greatest(
    coalesce(p_duration_minutes, ceil(extract(epoch from (now() - target_session.started_at)) / 60.0)::integer),
    1
  );

  update public.exercise_executions execution
  set status = case when exists (
    select 1 from public.set_executions set_actual
    where set_actual.exercise_execution_id = execution.id
      and set_actual.status = 'completed'
  ) then 'completed' else 'skipped' end
  where execution.workout_session_id = p_session_id;

  update public.workout_sessions
  set status = 'completed', completed_at = now(), duration_minutes = actual_duration, notes = p_notes
  where id = p_session_id;

  update public.session_prescriptions
  set status = 'completed', completed_at = now()
  where id = target_session.session_prescription_id;

  update public.method_cycles
  set push_session_id = case when target_session.split_key = 'push' then p_session_id else push_session_id end,
      pull_session_id = case when target_session.split_key = 'pull' then p_session_id else pull_session_id end,
      legs_session_id = case when target_session.split_key = 'legs' then p_session_id else legs_session_id end
  where id = target_session.cycle_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', exercise.canonical_name_zh,
      'status', execution.status,
      'sets', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'set', set_actual.set_index,
          'weight_kg', set_actual.actual_weight_kg,
          'reps', set_actual.actual_reps,
          'rir', set_actual.actual_rir,
          'extra', set_actual.is_extra
        ) order by set_actual.set_index), '[]'::jsonb)
        from public.set_executions set_actual
        where set_actual.exercise_execution_id = execution.id
          and set_actual.status = 'completed'
      )
    ) order by execution.order_index
  ), '[]'::jsonb)
  into legacy_exercises
  from public.exercise_executions execution
  join public.exercises exercise on exercise.id = execution.exercise_id
  where execution.workout_session_id = p_session_id;

  insert into public.workout_logs (
    user_id, date, type, duration_minutes, notes, exercises, method_workout_session_id
  ) values (
    current_user_id, current_date,
    case target_session.split_key when 'push' then '推' when 'pull' then '拉' else '腿' end,
    actual_duration, p_notes, legacy_exercises, p_session_id
  ) on conflict (method_workout_session_id) do nothing;

  if target_session.split_key = 'legs' then
    update public.method_cycles
    set status = 'completed', completed_at = now()
    where id = target_session.cycle_id;

    update public.method_enrollments
    set current_cycle_number = current_cycle_number + 1,
        next_split_key = 'push', current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number into next_cycle_number;

    insert into public.method_cycles (enrollment_id, cycle_number, status)
    values (target_session.enrollment_id, next_cycle_number, 'in_progress')
    returning id into new_cycle_id;

    select prescription.id into next_prescription_id
    from public.session_prescriptions prescription
    where prescription.cycle_id = new_cycle_id
      and prescription.split_key = 'push'
      and prescription.status in ('ready', 'upcoming', 'rest_deferred')
    limit 1;
    next_split := 'push';
    did_complete_cycle := true;
  else
    next_split := case target_session.split_key when 'push' then 'pull' else 'legs' end;
    update public.method_enrollments
    set next_split_key = next_split, current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number into next_cycle_number;

    next_prescription_id := public.create_session_prescription_for_cycle(target_session.cycle_id);
  end if;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'completed',
    'idempotent', false,
    'completed_split_key', target_session.split_key,
    'next_split_key', next_split,
    'current_cycle_number', next_cycle_number,
    'cycle_completed', did_complete_cycle,
    'next_prescription_id', next_prescription_id
  );
end;
$$;

revoke all on function public.start_method_session(uuid) from public, anon;
revoke all on function public.save_method_set_actual(uuid, uuid, integer, numeric, integer, numeric) from public, anon;
revoke all on function public.complete_method_session(uuid, integer, text) from public, anon;
grant execute on function public.start_method_session(uuid) to authenticated;
grant execute on function public.save_method_set_actual(uuid, uuid, integer, numeric, integer, numeric) to authenticated;
grant execute on function public.complete_method_session(uuid, integer, text) to authenticated;

comment on table public.workout_sessions is
  'Normalized Method workout actual. Prescription remains immutable and separate.';
comment on function public.complete_method_session(uuid, integer, text) is
  'Idempotently closes a planned Method session, mirrors it to legacy history, advances Push/Pull/Legs, and creates the next prescription.';

commit;
