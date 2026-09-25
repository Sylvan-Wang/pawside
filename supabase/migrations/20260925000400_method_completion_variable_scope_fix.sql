-- Pawside Minimum P1 forward fix for complete_method_session_v2.
--
-- 20260925000200 declared a local PL/pgSQL variable named completed_exercise_count,
-- which is also the name of the public.workout_sessions column the function writes.
-- PostgreSQL resolves that as an ambiguous column/variable reference (SQLSTATE
-- 42702), so the runtime UPDATE below failed on every call:
--
--   update public.workout_sessions
--   set completed_exercise_count = completed_exercise_count   -- ambiguous
--
-- This was found by `supabase db lint --linked` (plpgsql_check) AFTER
-- 20260925000200 had already been applied, so the correction is recorded forward
-- rather than by rewriting an applied migration.
--
-- The local variable is renamed to completed_count. The stored column name and the
-- JSON response key stay 'completed_exercise_count', so no consumer changes.

begin;
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
  select count(*) into completed_count
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

  if completed_count < required_exercise_count then
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
      'completed_exercise_count', completed_count,
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
    'completed_exercise_count', completed_count,
    'required_exercise_count', required_exercise_count,
    'original_exercise_count', original_exercise_count,
    'selected_session_minutes', target_session.selected_session_minutes,
    'execution_mode', target_session.execution_mode,
    'log_date', target_session.log_date,
    'next_prescription_id', next_prescription_id
  );
end;
$$;
revoke all on function public.complete_method_session_v2(uuid, uuid, integer, text) from public, anon;
grant execute on function public.complete_method_session_v2(uuid, uuid, integer, text) to authenticated;

comment on function public.complete_method_session_v2(uuid, uuid, integer, text) is
  'Minimum P1 completion: exercise_count_threshold_v1. An exercise counts only when every prescribed set of that exercise is completed; the Program Day completes once the completed exercise count reaches the required exercise count, and the remaining exercises neither block nor create outstanding work.';

commit;