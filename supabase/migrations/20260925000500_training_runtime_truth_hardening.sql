-- Pawside Runtime Truth hardening after Minimum P1 review.
--
-- Terminal guarantees:
--   * a user can own at most one started workout session;
--   * a zero-set exercise is never treated as fully completed;
--   * supplemental and pre-Minimum-P1 sessions close after one persisted set
--     actual, without pretending that a full exercise was completed;
--   * active-session duration can only be shortened;
--   * the post-cutover schema is reproducible from migrations alone.

begin;

-- The historical cutover already removed this in production. Keeping the
-- idempotent DROP in migrations makes fresh/staging/disaster-recovery schemas
-- converge on the same terminal state.
alter table public.workout_sessions
  drop constraint if exists workout_sessions_session_prescription_id_key;

create index if not exists workout_sessions_prescription_idx
  on public.workout_sessions(session_prescription_id, started_at desc);

do $$
begin
  if exists (
    select 1
    from public.workout_sessions
    where status = 'started'
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce one active workout session: duplicate started sessions require controlled repair';
  end if;
end;
$$;

create unique index if not exists workout_sessions_one_started_per_user_idx
  on public.workout_sessions(user_id)
  where status = 'started';

-- Restore least privilege even on projects whose historical default grants
-- left table-level INSERT available. RLS already default-denies writes, but the
-- table privilege must agree with the RPC-only state machine.
revoke insert, update, delete on table
  public.method_enrollments,
  public.method_cycles
from authenticated;
grant select on table public.method_enrollments, public.method_cycles to authenticated;

-- User-serialized start wrapper. The partial unique index remains the final
-- race-proof guard even if an older caller still invokes start_method_session_v2.
create or replace function public.start_method_session_v3(
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
  request_session record;
  active_session record;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_start_request_id is null then
    raise exception 'Start request id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select session.id, session.status, session.execution_mode, session.log_date,
         session.selected_session_minutes, session.required_exercise_count,
         session.session_prescription_id, session.split_key
  into request_session
  from public.workout_sessions session
  where session.user_id = current_user_id
    and session.start_request_id = p_start_request_id;

  if request_session.id is not null then
    return jsonb_build_object(
      'session_id', request_session.id,
      'status', request_session.status,
      'execution_mode', request_session.execution_mode,
      'log_date', request_session.log_date,
      'selected_session_minutes', request_session.selected_session_minutes,
      'required_exercise_count', request_session.required_exercise_count,
      'idempotent', true,
      'active_session_conflict', false
    );
  end if;

  select session.id, session.status, session.execution_mode, session.log_date,
         session.selected_session_minutes, session.required_exercise_count,
         session.session_prescription_id, session.split_key
  into active_session
  from public.workout_sessions session
  where session.user_id = current_user_id
    and session.status = 'started'
  order by session.started_at desc
  limit 1
  for update;

  if active_session.id is not null then
    if active_session.session_prescription_id = p_prescription_id then
      return jsonb_build_object(
        'session_id', active_session.id,
        'status', active_session.status,
        'execution_mode', active_session.execution_mode,
        'log_date', active_session.log_date,
        'selected_session_minutes', active_session.selected_session_minutes,
        'required_exercise_count', active_session.required_exercise_count,
        'idempotent', true,
        'active_session_conflict', false
      );
    end if;

    return jsonb_build_object(
      'status', 'conflict',
      'active_session_conflict', true,
      'active_session_id', active_session.id,
      'active_split_key', active_session.split_key,
      'idempotent', true
    );
  end if;

  return public.start_method_session_v2(
    p_prescription_id,
    p_view_date,
    p_time_zone,
    p_start_request_id,
    p_selected_session_minutes,
    p_selection_source
  );
end;
$$;

revoke all on function public.start_method_session_v3(uuid, date, text, uuid, smallint, text)
  from public, anon;
grant execute on function public.start_method_session_v3(uuid, date, text, uuid, smallint, text)
  to authenticated;

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
  recomputed_required_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_selected_session_minutes not in (30, 45, 60, 90) then
    raise exception 'Invalid session duration' using errcode = '22023';
  end if;
  if resolved_source <> 'mid_session_change' then
    raise exception 'Invalid session duration source' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select session.id, session.user_id, session.status, session.original_exercise_count,
         session.required_exercise_count, session.selected_session_minutes,
         session.execution_mode, session.completion_policy_version
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id
  for update;

  if target_session.user_id is null or target_session.user_id <> current_user_id then
    raise exception 'Training session not found' using errcode = 'P0002';
  end if;
  if target_session.status <> 'started' then
    raise exception 'Only an active session duration can be changed' using errcode = '55000';
  end if;
  if target_session.execution_mode <> 'canonical'
     or target_session.selected_session_minutes is null
     or target_session.original_exercise_count is null
     or target_session.required_exercise_count is null then
    raise exception 'Duration adaptation requires a snapshotted canonical session' using errcode = '22023';
  end if;
  if p_selected_session_minutes > target_session.selected_session_minutes then
    raise exception 'Duration can only be shortened' using errcode = '22023';
  end if;

  recomputed_required_count := least(
    target_session.original_exercise_count,
    ceil(target_session.original_exercise_count * p_selected_session_minutes / 60.0)::integer
  );

  update public.workout_sessions
  set selected_session_minutes = p_selected_session_minutes,
      selection_source = resolved_source,
      required_exercise_count = recomputed_required_count
  where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'started',
    'selected_session_minutes', p_selected_session_minutes,
    'selection_source', resolved_source,
    'original_exercise_count', target_session.original_exercise_count,
    'required_exercise_count', recomputed_required_count,
    'completion_policy_version', 'exercise_count_threshold_v1',
    'idempotent', false
  );
end;
$$;

revoke all on function public.update_method_session_duration(uuid, smallint, text)
  from public, anon;
grant execute on function public.update_method_session_duration(uuid, smallint, text)
  to authenticated;

-- Replace the terminal v2 definition forward. Legacy callers of
-- complete_method_session(uuid, integer, text) remain untouched.
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
  completed_count integer;
  completed_set_count integer;
  required_exercise_count integer;
  original_exercise_count integer;
  actual_duration integer;
  next_split text;
  next_cycle_number integer;
  next_prescription_id uuid;
  new_cycle_id uuid;
  legacy_exercises jsonb;
  non_advancing boolean;
  legacy_set_gate boolean;
  completion_policy text;
  ledger_next_split text;
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
         session.original_exercise_count, session.completion_policy_version,
         session.completed_exercise_count
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
  legacy_set_gate := not non_advancing
    and target_session.selected_session_minutes is null
    and target_session.required_exercise_count is null
    and target_session.completion_policy_version is null;
  completion_policy := coalesce(
    target_session.completion_policy_version,
    case
      when non_advancing then 'supplemental_actual_v1'
      when legacy_set_gate then 'legacy_one_completed_set_v1'
      else 'exercise_count_threshold_v1'
    end
  );

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
      'program_day_completed', not non_advancing,
      'session_sequence_advanced', false,
      'progression_advanced', false,
      'completed_exercise_count', target_session.completed_exercise_count,
      'selected_session_minutes', target_session.selected_session_minutes,
      'required_exercise_count', target_session.required_exercise_count,
      'original_exercise_count', target_session.original_exercise_count,
      'completion_policy_version', completion_policy,
      'completion_count_unit', case when completion_policy = 'exercise_count_threshold_v1' then 'exercise' else 'set' end,
      'execution_mode', target_session.execution_mode,
      'log_date', target_session.log_date
    );
  end if;

  select count(*) into total_exercise_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id;

  if total_exercise_count = 0 then
    raise exception 'At least one prescribed exercise is required' using errcode = '22023';
  end if;

  -- An exercise counts only when at least one original set prescription exists,
  -- every expected set execution exists, and every expected set is completed.
  -- Extra actual sets never substitute for a missing Method template.
  select count(*) into completed_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id
    and exists (
      select 1
      from public.set_prescriptions set_plan
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
    )
    and not exists (
      select 1
      from public.set_prescriptions set_plan
      left join public.set_executions set_actual
        on set_actual.exercise_execution_id = execution.id
       and set_actual.set_prescription_id = set_plan.id
       and set_actual.is_extra = false
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
        and (set_actual.id is null or set_actual.status <> 'completed')
    );

  select count(*) into completed_set_count
  from public.set_executions set_actual
  where set_actual.workout_session_id = p_session_id
    and set_actual.status = 'completed';

  original_exercise_count := coalesce(target_session.original_exercise_count, total_exercise_count);

  if non_advancing or legacy_set_gate then
    if completed_set_count < 1 then
      raise exception 'At least one persisted set actual is required' using errcode = '22023';
    end if;
    required_exercise_count := target_session.required_exercise_count;
  else
    required_exercise_count := coalesce(
      target_session.required_exercise_count,
      case
        when target_session.selected_session_minutes is not null then
          least(
            total_exercise_count,
            ceil(total_exercise_count * target_session.selected_session_minutes / 60.0)::integer
          )
        else total_exercise_count
      end
    );
    required_exercise_count := least(required_exercise_count, total_exercise_count);
    if completed_count < required_exercise_count then
      raise exception 'Session completion threshold not reached' using errcode = '22023';
    end if;
  end if;

  actual_duration := greatest(
    coalesce(p_duration_minutes, ceil(extract(epoch from (now() - target_session.started_at)) / 60.0)::integer),
    1
  );

  update public.exercise_executions execution
  set status = 'completed'
  where execution.workout_session_id = p_session_id
    and exists (
      select 1
      from public.set_prescriptions set_plan
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
    )
    and not exists (
      select 1
      from public.set_prescriptions set_plan
      left join public.set_executions set_actual
        on set_actual.exercise_execution_id = execution.id
       and set_actual.set_prescription_id = set_plan.id
       and set_actual.is_extra = false
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
        and (set_actual.id is null or set_actual.status <> 'completed')
    );

  update public.workout_sessions
  set status = 'completed',
      completed_at = now(),
      duration_minutes = actual_duration,
      notes = p_notes,
      completion_rule_version = completion_policy,
      completion_policy_version = completion_policy,
      completed_exercise_count = completed_count
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
      'completed_exercise_count', completed_count,
      'required_exercise_count', target_session.required_exercise_count,
      'original_exercise_count', original_exercise_count,
      'selected_session_minutes', target_session.selected_session_minutes,
      'completion_policy_version', completion_policy,
      'completion_count_unit', 'set',
      'completed_count', completed_set_count,
      'required_count', 1,
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
    'progression_advanced', false,
    'completed_exercise_count', completed_count,
    'required_exercise_count', required_exercise_count,
    'original_exercise_count', original_exercise_count,
    'selected_session_minutes', target_session.selected_session_minutes,
    'completion_policy_version', completion_policy,
    'completion_count_unit', case when legacy_set_gate then 'set' else 'exercise' end,
    'completed_count', case when legacy_set_gate then completed_set_count else completed_count end,
    'required_count', case when legacy_set_gate then 1 else required_exercise_count end,
    'execution_mode', target_session.execution_mode,
    'log_date', target_session.log_date,
    'next_prescription_id', next_prescription_id
  );
end;
$$;

revoke all on function public.complete_method_session_v2(uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.complete_method_session_v2(uuid, uuid, integer, text)
  to authenticated;

comment on function public.start_method_session_v3(uuid, date, text, uuid, smallint, text) is
  'User-serialized Minimum P1 start. Returns the existing active session instead of creating a parallel active session.';
comment on function public.complete_method_session_v2(uuid, uuid, integer, text) is
  'Runtime truth completion: canonical Minimum P1 counts only exercises with complete original set prescriptions; supplemental and legacy sessions require one persisted set actual and never fabricate exercise completion.';
comment on index public.workout_sessions_one_started_per_user_idx is
  'At most one started workout session per user; viewing other Program Days remains unrestricted.';

commit;
