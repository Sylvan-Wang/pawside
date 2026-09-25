-- Pawside Internal Beta P0 + Minimum P1:
--   * training date navigation (view_date / performed_at / performed_time_zone /
--     log_date / execution_mode / start_request_id)
--   * start_method_session_v2  (canonical|replay|supplemental + duration snapshot)
--   * update_method_session_duration (PRD §7 mid-session shortening)
--   * complete_method_session_v2     (self-contained Minimum P1 completion gate)
--
-- STRUCTURAL GUARANTEE: the legacy
--   public.complete_method_session(uuid, integer, text)
-- is NOT redefined here. It keeps its ef51a06 release semantics, so the released
-- caller cannot be silently changed. All new behaviour lives in the *_v2 names.
--
-- This migration does NOT drop UNIQUE(workout_sessions.session_prescription_id).
-- That is a cutover step, held in supabase/cutover/, to be executed only together
-- with the app change that stops assuming one session per prescription.

begin;

-- ---------------------------------------------------------------------------
-- 1. Training date attribution (Program Day is independent from calendar date)
-- ---------------------------------------------------------------------------

alter table public.workout_sessions
  add column view_date date,
  add column performed_at timestamptz,
  add column performed_time_zone text,
  add column execution_mode text,
  add column start_request_id uuid;

update public.workout_sessions session
set view_date = coalesce(prescription.planned_for_date, session.log_date),
    performed_at = session.started_at,
    performed_time_zone = 'UTC',
    execution_mode = 'canonical'
from public.session_prescriptions prescription
where prescription.id = session.session_prescription_id
  and session.view_date is null;

update public.workout_sessions
set view_date = coalesce(view_date, log_date),
    performed_at = coalesce(performed_at, started_at, created_at),
    performed_time_zone = coalesce(performed_time_zone, 'UTC'),
    execution_mode = coalesce(execution_mode, 'canonical');

alter table public.workout_sessions
  alter column view_date set default current_date,
  alter column view_date set not null,
  alter column performed_at set default now(),
  alter column performed_at set not null,
  alter column performed_time_zone set default 'UTC',
  alter column performed_time_zone set not null,
  alter column execution_mode set default 'canonical',
  alter column execution_mode set not null,
  add constraint workout_sessions_execution_mode_check
    check (execution_mode in ('canonical', 'replay', 'supplemental'));

create index workout_sessions_prescription_idx
  on public.workout_sessions(session_prescription_id, started_at desc);
create index workout_sessions_user_view_date_idx
  on public.workout_sessions(user_id, view_date, started_at desc);
create unique index workout_sessions_start_request_idx
  on public.workout_sessions(user_id, start_request_id)
  where start_request_id is not null;

comment on column public.workout_sessions.view_date is
  'Date whose prescription was displayed. It never determines workout history attribution.';
comment on column public.workout_sessions.performed_at is
  'Authoritative instant at which this execution began.';
comment on column public.workout_sessions.log_date is
  'History/statistics date derived from performed_at in performed_time_zone.';
comment on column public.workout_sessions.execution_mode is
  'canonical satisfies a not-yet-completed Program Day and may advance the sequence; replay and supplemental record execution without changing Program Day completion or the cycle ledger.';

-- ---------------------------------------------------------------------------
-- 2. start_method_session_v2
--    Minimum P1 §8: snapshot original_exercise_count / required_exercise_count /
--    selected_session_minutes / selection_source / completion_policy_version.
--    Never preselect which exercises must be done.
-- ---------------------------------------------------------------------------

create or replace function public.start_method_session_v2(
  p_prescription_id uuid,
  p_view_date date,
  p_time_zone text,
  p_start_request_id uuid,
  p_selected_session_minutes smallint default null,
  p_selection_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_prescription record;
  existing_session record;
  created_session_id uuid;
  execution_time timestamptz := clock_timestamp();
  derived_log_date date;
  target_execution_mode text;
  preferred_minutes integer;
  resolved_minutes smallint;
  resolved_source text;
  original_exercise_count integer;
  required_exercise_count integer;
  completion_policy text := 'exercise_count_threshold_v1';
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_view_date is null or p_time_zone is null or length(p_time_zone) > 100 or p_start_request_id is null then
    raise exception 'View date, time zone and start request id are required' using errcode = '22023';
  end if;

  -- Minimum P1 §8: client value wins; otherwise the long-term onboarding
  -- preference; otherwise the existing default of 60.
  if p_selected_session_minutes is null then
    select profile.preferred_session_minutes into preferred_minutes
    from public.onboarding_capability_profiles profile
    where profile.user_id = current_user_id;
    resolved_minutes := coalesce(preferred_minutes, 60)::smallint;
    resolved_source := 'profile_default';
  else
    resolved_minutes := p_selected_session_minutes;
    resolved_source := coalesce(p_selection_source, 'user_override');
  end if;

  if resolved_minutes not in (30, 45, 60, 90) then
    raise exception 'Invalid session duration' using errcode = '22023';
  end if;
  if resolved_source not in ('profile_default', 'user_override', 'mid_session_change') then
    raise exception 'Invalid session duration source' using errcode = '22023';
  end if;

  begin
    derived_log_date := (execution_time at time zone p_time_zone)::date;
  exception when invalid_parameter_value then
    raise exception 'Invalid time zone' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_prescription_id::text, 0));

  select session.id, session.status, session.execution_mode, session.log_date,
         session.selected_session_minutes, session.required_exercise_count
  into existing_session
  from public.workout_sessions session
  where session.user_id = current_user_id
    and session.start_request_id = p_start_request_id;
  if existing_session.id is not null then
    return jsonb_build_object(
      'session_id', existing_session.id,
      'status', existing_session.status,
      'execution_mode', existing_session.execution_mode,
      'log_date', existing_session.log_date,
      'selected_session_minutes', existing_session.selected_session_minutes,
      'required_exercise_count', existing_session.required_exercise_count,
      'idempotent', true
    );
  end if;

  select prescription.user_id, prescription.enrollment_id, prescription.cycle_id,
         prescription.split_key, prescription.status
  into target_prescription
  from public.session_prescriptions prescription
  where prescription.id = p_prescription_id
  for update;

  if target_prescription.user_id is null or target_prescription.user_id <> current_user_id then
    raise exception 'Training prescription not found' using errcode = 'P0002';
  end if;
  if target_prescription.status = 'cancelled' then
    raise exception 'Cancelled training prescription cannot be executed' using errcode = '55000';
  end if;

  select session.id, session.status, session.execution_mode, session.log_date,
         session.selected_session_minutes, session.required_exercise_count
  into existing_session
  from public.workout_sessions session
  where session.user_id = current_user_id
    and session.session_prescription_id = p_prescription_id
    and session.view_date = p_view_date
    and session.status = 'started'
  order by session.started_at desc
  limit 1;
  if existing_session.id is not null then
    return jsonb_build_object(
      'session_id', existing_session.id,
      'status', existing_session.status,
      'execution_mode', existing_session.execution_mode,
      'log_date', existing_session.log_date,
      'selected_session_minutes', existing_session.selected_session_minutes,
      'required_exercise_count', existing_session.required_exercise_count,
      'idempotent', true
    );
  end if;

  -- Minimum P1 §11: execution_mode is decided by whether the Program Day has
  -- already been completed, not by the calendar date. Out-of-order Program Days
  -- (Day 3 before Day 2) are legitimately canonical.
  target_execution_mode := case
    when target_prescription.status = 'completed' then 'supplemental'
    when exists (
      select 1 from public.workout_sessions session
      where session.session_prescription_id = p_prescription_id
        and session.execution_mode = 'canonical'
        and session.status = 'completed'
    ) then 'supplemental'
    when exists (
      select 1
      from public.method_enrollments enrollment
      join public.method_cycles cycle
        on cycle.id = target_prescription.cycle_id
       and cycle.enrollment_id = enrollment.id
      where enrollment.id = target_prescription.enrollment_id
        and enrollment.user_id = current_user_id
        and enrollment.status = 'active'
        and cycle.status = 'in_progress'
    ) then 'canonical'
    else 'replay'
  end;

  select count(*) into original_exercise_count
  from public.exercise_prescriptions prescription
  where prescription.session_prescription_id = p_prescription_id;

  required_exercise_count := least(
    original_exercise_count,
    ceil(original_exercise_count * resolved_minutes / 60.0)::integer
  );

  insert into public.workout_sessions (
    user_id, session_prescription_id, enrollment_id, cycle_id, split_key,
    status, view_date, performed_at, performed_time_zone, log_date,
    execution_mode, start_request_id,
    selected_session_minutes, selection_source,
    original_exercise_count, required_exercise_count, completion_policy_version
  ) values (
    current_user_id, p_prescription_id, target_prescription.enrollment_id,
    target_prescription.cycle_id, target_prescription.split_key,
    'started', p_view_date, execution_time, p_time_zone, derived_log_date,
    target_execution_mode, p_start_request_id,
    resolved_minutes, resolved_source,
    original_exercise_count, required_exercise_count, completion_policy
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

  if target_execution_mode = 'canonical' then
    update public.session_prescriptions
    set status = 'started', started_at = coalesce(started_at, execution_time)
    where id = p_prescription_id;

    update public.method_enrollments
    set current_state = 'session_in_progress'
    where id = target_prescription.enrollment_id;
  end if;

  return jsonb_build_object(
    'session_id', created_session_id,
    'status', 'started',
    'execution_mode', target_execution_mode,
    'view_date', p_view_date,
    'performed_at', execution_time,
    'log_date', derived_log_date,
    'selected_session_minutes', resolved_minutes,
    'selection_source', resolved_source,
    'original_exercise_count', original_exercise_count,
    'required_exercise_count', required_exercise_count,
    'completion_policy_version', completion_policy,
    'idempotent', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. update_method_session_duration  (Minimum P1 §7)
--    Shortening an active session keeps every saved set actual and never
--    recreates the session or rewrites the Method prescription.
-- ---------------------------------------------------------------------------

create or replace function public.update_method_session_duration(
  p_session_id uuid,
  p_selected_session_minutes smallint,
  p_selection_source text default 'mid_session_change'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_session record;
  resolved_source text := coalesce(p_selection_source, 'mid_session_change');
  effective_original_count integer;
  recomputed_required_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_selected_session_minutes not in (30, 45, 60, 90) then
    raise exception 'Invalid session duration' using errcode = '22023';
  end if;
  if resolved_source not in ('profile_default', 'user_override', 'mid_session_change') then
    raise exception 'Invalid session duration source' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select session.id, session.user_id, session.status, session.original_exercise_count,
         session.execution_mode
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id
  for update;

  if target_session.user_id is null or target_session.user_id <> current_user_id then
    raise exception 'Training session not found' using errcode = 'P0002';
  end if;

  -- Minimum P1 §7: a completed session is never reopened.
  if target_session.status <> 'started' then
    raise exception 'Only an active session duration can be changed' using errcode = '55000';
  end if;

  effective_original_count := coalesce(
    target_session.original_exercise_count,
    (
      select count(*) from public.exercise_executions execution
      where execution.workout_session_id = p_session_id
    )
  );

  recomputed_required_count := case
    -- Mirrors complete_method_session_v2: a non-advancing execution keeps the
    -- released "at least one" floor, so the reported threshold always matches the
    -- threshold the server enforces.
    when target_session.execution_mode in ('replay', 'supplemental')
      then least(1, effective_original_count)
    else least(
      effective_original_count,
      ceil(effective_original_count * p_selected_session_minutes / 60.0)::integer
    )
  end;

  update public.workout_sessions
  set selected_session_minutes = p_selected_session_minutes,
      selection_source = resolved_source,
      original_exercise_count = effective_original_count,
      required_exercise_count = recomputed_required_count
  where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'started',
    'selected_session_minutes', p_selected_session_minutes,
    'selection_source', resolved_source,
    'original_exercise_count', effective_original_count,
    'required_exercise_count', recomputed_required_count,
    'completion_policy_version', 'exercise_count_threshold_v1',
    'idempotent', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. complete_method_session_v2  (Minimum P1 §5, §6, §9, §10, §11, §12)
--    Self-contained: it does NOT delegate to the legacy function, so the legacy
--    gate can never be changed by this migration.
-- ---------------------------------------------------------------------------

create or replace function public.complete_method_session_v2(
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
declare
  current_user_id uuid := auth.uid();
  target_session record;
  total_exercise_count integer;
  completed_exercise_count integer;
  required_exercise_count integer;
  original_exercise_count integer;
  actual_duration integer;
  next_split text;
  next_cycle_number integer;
  next_prescription_id uuid;
  new_cycle_id uuid;
  ledger_next_split text;
  legacy_exercises jsonb;
  non_advancing boolean;
  cycle_finished boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_completion_request_id is null then
    raise exception 'Completion request id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select session.id, session.user_id, session.session_prescription_id,
         session.enrollment_id, session.cycle_id, session.split_key,
         session.status, session.started_at, session.execution_mode,
         session.log_date, session.completion_request_id,
         session.selected_session_minutes, session.required_exercise_count,
         session.original_exercise_count
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id
  for update;

  if target_session.user_id is null or target_session.user_id <> current_user_id then
    raise exception 'Training session not found' using errcode = 'P0002';
  end if;

  if target_session.status <> 'completed'
     and target_session.completion_request_id is not null
     and target_session.completion_request_id <> p_completion_request_id then
    raise exception 'A different completion request is already in progress' using errcode = '55000';
  end if;

  if target_session.status <> 'completed' then
    update public.workout_sessions
    set completion_request_id = p_completion_request_id
    where id = p_session_id;
  end if;

  non_advancing := target_session.execution_mode in ('replay', 'supplemental');

  -- Minimum P1 §10: the cycle ledger decides the next Program Day.
  select candidate.split_key into ledger_next_split
  from (values ('push', 1), ('pull', 2), ('legs', 3)) as candidate(split_key, ord)
  where not exists (
    select 1 from public.session_prescriptions prescription
    where prescription.cycle_id = target_session.cycle_id
      and prescription.split_key = candidate.split_key
      and prescription.status = 'completed'
  )
  order by candidate.ord
  limit 1;

  if target_session.status = 'completed' then
    select enrollment.next_split_key, enrollment.current_cycle_number
    into next_split, next_cycle_number
    from public.method_enrollments enrollment
    where enrollment.id = target_session.enrollment_id;
    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'completed',
      'idempotent', true,
      'next_split_key', next_split,
      'current_cycle_number', next_cycle_number,
      'cycle_completed', ledger_next_split is null,
      'program_day_completed', false,
      'session_sequence_advanced', false,
      'progression_advanced', false,
      'selected_session_minutes', target_session.selected_session_minutes,
      'required_exercise_count', target_session.required_exercise_count,
      'original_exercise_count', target_session.original_exercise_count,
      'execution_mode', target_session.execution_mode,
      'log_date', target_session.log_date
    );
  end if;

  select count(*) into total_exercise_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id;

  -- Preserve the legacy refusal to complete a session with no prescribed work.
  if total_exercise_count = 0 then
    raise exception 'At least one prescribed exercise is required' using errcode = '22023';
  end if;

  -- Minimum P1 §4.2 / §5: an exercise counts only when every prescribed set of
  -- that exercise is completed. Extra sets beyond the prescription never count
  -- against the user. Remaining exercises are not resolved in any way.
  select count(*) into completed_exercise_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id
    and not exists (
      select 1 from public.set_executions set_actual
      where set_actual.exercise_execution_id = execution.id
        and set_actual.is_extra = false
        and set_actual.status <> 'completed'
    );

  original_exercise_count := coalesce(target_session.original_exercise_count, total_exercise_count);

  -- Minimum P1 §11.2 / §12: a replay or supplemental execution never completes the
  -- Program Day, so the Program Day threshold does not apply to it. The PRD does
  -- not define a threshold for these, so the released "at least one" floor is
  -- kept rather than inventing a rule; otherwise a supplemental session could
  -- never be closed. Sessions started before Minimum P1 keep the same floor.
  required_exercise_count := case
    when non_advancing then least(1, total_exercise_count)
    else coalesce(
      target_session.required_exercise_count,
      case
        when target_session.selected_session_minutes is not null then
          least(
            total_exercise_count,
            ceil(total_exercise_count * target_session.selected_session_minutes / 60.0)::integer
          )
        else
          1
      end
    )
  end;
  if required_exercise_count > total_exercise_count then
    required_exercise_count := total_exercise_count;
  end if;

  if completed_exercise_count < required_exercise_count then
    raise exception 'Session completion threshold not reached'
      using errcode = '22023';
  end if;

  actual_duration := greatest(
    coalesce(p_duration_minutes, ceil(extract(epoch from (now() - target_session.started_at)) / 60.0)::integer),
    1
  );

  -- Minimum P1 §6: only fully completed exercises become 'completed'. Everything
  -- else keeps its existing state; it is never forced to 'skipped' and creates no
  -- outstanding work.
  update public.exercise_executions execution
  set status = 'completed'
  where execution.workout_session_id = p_session_id
    and not exists (
      select 1 from public.set_executions set_actual
      where set_actual.exercise_execution_id = execution.id
        and set_actual.is_extra = false
        and set_actual.status <> 'completed'
    );

  update public.workout_sessions
  set status = 'completed',
      completed_at = now(),
      duration_minutes = actual_duration,
      notes = p_notes,
      completion_rule_version = 'exercise_count_threshold_v1',
      completion_policy_version = 'exercise_count_threshold_v1',
      completed_exercise_count = completed_exercise_count
  where id = p_session_id;

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
    current_user_id, target_session.log_date,
    case target_session.split_key when 'push' then '推' when 'pull' then '拉' else '腿' end,
    actual_duration, p_notes, legacy_exercises, p_session_id
  ) on conflict (method_workout_session_id) do nothing;

  -- Minimum P1 §11.2 / §12: a supplemental (or historical replay) execution is
  -- recorded but never completes the Program Day again and never advances.
  if non_advancing then
    select enrollment.next_split_key, enrollment.current_cycle_number
    into next_split, next_cycle_number
    from public.method_enrollments enrollment
    where enrollment.id = target_session.enrollment_id;
    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'completed',
      'idempotent', false,
      'completed_split_key', target_session.split_key,
      'next_split_key', next_split,
      'current_cycle_number', next_cycle_number,
      'cycle_completed', false,
      'program_day_completed', false,
      'session_sequence_advanced', false,
      'progression_advanced', false,
      'completed_exercise_count', completed_exercise_count,
      'required_exercise_count', required_exercise_count,
      'original_exercise_count', original_exercise_count,
      'selected_session_minutes', target_session.selected_session_minutes,
      'execution_mode', target_session.execution_mode,
      'log_date', target_session.log_date,
      'next_prescription_id', null
    );
  end if;

  update public.session_prescriptions
  set status = 'completed', completed_at = now()
  where id = target_session.session_prescription_id;

  update public.method_cycles
  set push_session_id = case when target_session.split_key = 'push' then p_session_id else push_session_id end,
      pull_session_id = case when target_session.split_key = 'pull' then p_session_id else pull_session_id end,
      legs_session_id = case when target_session.split_key = 'legs' then p_session_id else legs_session_id end
  where id = target_session.cycle_id;

  -- Recompute the earliest Program Day in this cycle that is still incomplete.
  select candidate.split_key into next_split
  from (values ('push', 1), ('pull', 2), ('legs', 3)) as candidate(split_key, ord)
  where not exists (
    select 1 from public.session_prescriptions prescription
    where prescription.cycle_id = target_session.cycle_id
      and prescription.split_key = candidate.split_key
      and prescription.status = 'completed'
  )
  order by candidate.ord
  limit 1;

  if next_split is null then
    -- Minimum P1 §10: only a fully completed cycle closes and advances.
    cycle_finished := true;
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

    next_split := 'push';
    next_prescription_id := public.create_session_prescription_for_cycle(new_cycle_id);
  else
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
    'cycle_completed', cycle_finished,
    'program_day_completed', true,
    'session_sequence_advanced', true,
    'progression_advanced', true,
    'completed_exercise_count', completed_exercise_count,
    'required_exercise_count', required_exercise_count,
    'original_exercise_count', original_exercise_count,
    'selected_session_minutes', target_session.selected_session_minutes,
    'execution_mode', target_session.execution_mode,
    'log_date', target_session.log_date,
    'next_prescription_id', next_prescription_id
  );
end;
$$;

revoke all on function public.start_method_session_v2(uuid, date, text, uuid, smallint, text) from public, anon;
grant execute on function public.start_method_session_v2(uuid, date, text, uuid, smallint, text) to authenticated;

revoke all on function public.update_method_session_duration(uuid, smallint, text) from public, anon;
grant execute on function public.update_method_session_duration(uuid, smallint, text) to authenticated;

revoke all on function public.complete_method_session_v2(uuid, uuid, integer, text) from public, anon;
grant execute on function public.complete_method_session_v2(uuid, uuid, integer, text) to authenticated;

comment on function public.complete_method_session_v2(uuid, uuid, integer, text) is
  'Minimum P1 completion: exercise_count_threshold_v1. An exercise counts only when every prescribed set of that exercise is completed; the Program Day completes once completed_exercise_count reaches required_exercise_count, and the remaining exercises neither block nor create outstanding work.';

comment on function public.update_method_session_duration(uuid, smallint, text) is
  'Minimum P1 mid-session shortening: recomputes required_exercise_count for an active session without discarding any saved set actual.';

comment on function public.start_method_session_v2(uuid, date, text, uuid, smallint, text) is
  'Minimum P1 start: snapshots the session duration policy, keeps the full prescription, and decides canonical/supplemental from Program Day completion rather than calendar date.';

commit;
