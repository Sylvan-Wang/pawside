-- Pawside Minimum P1 contract: exercise-count time adaptation.
--
-- Mirrors the deterministic rules in Pawside_Minimum_P1_PRD_Patch.md §4, §5, §7, §8
-- as they are realised by the migrations on this branch.

begin;

do $$
declare
  start_definition text;
  completion_definition text;
  duration_definition text;
begin
  -- ---------------------------------------------------------------------
  -- §3.2 snapshot columns exist with the documented domains
  -- ---------------------------------------------------------------------
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name in (
        'selected_session_minutes', 'selection_source',
        'required_exercise_count', 'original_exercise_count',
        'completion_policy_version'
      )
  ) <> 5 then
    raise exception 'Minimum P1 audit columns are incomplete';
  end if;

  -- §17: the audit must not store a preselected exercise list.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_sessions'
      and column_name in ('required_exercise_ids', 'omitted_exercise_ids')
  ) then
    raise exception 'Minimum P1 must not preselect which exercises are required';
  end if;

  select pg_get_functiondef('public.start_method_session_v2(uuid,date,text,uuid,smallint,text)'::regprocedure)
  into start_definition;
  select pg_get_functiondef('public.complete_method_session_v2(uuid,uuid,integer,text)'::regprocedure)
  into completion_definition;
  select pg_get_functiondef('public.update_method_session_duration(uuid,smallint,text)'::regprocedure)
  into duration_definition;

  -- ---------------------------------------------------------------------
  -- §4.3 / §8: required_exercise_count = ceil(original * minutes / 60), capped
  -- at the original count, snapshotted at start.
  -- ---------------------------------------------------------------------
  if position('ceil(original_exercise_count * resolved_minutes / 60.0)' in replace(start_definition, ' ', ' ')) = 0
     and position('ceil(original_exercise_count * resolved_minutes / 60.0)' in start_definition) = 0 then
    raise exception 'start_method_session_v2 does not compute the Minimum P1 threshold';
  end if;

  -- §8: server-side fallback chain profile -> 60
  if position('preferred_session_minutes' in start_definition) = 0 then
    raise exception 'start_method_session_v2 does not fall back to the onboarding preference';
  end if;

  -- §8: full prescription is still copied; no exercise filtering by order/role
  if position('method_role' in start_definition) > 0 then
    raise exception 'start_method_session_v2 filters exercises by method_role';
  end if;

  -- ---------------------------------------------------------------------
  -- §5: the completion gate is exercise-count based
  -- ---------------------------------------------------------------------
  if position('exercise_count_threshold_v1' in completion_definition) = 0 then
    raise exception 'Completion policy version exercise_count_threshold_v1 is missing';
  end if;
  if position('completed_count < required_exercise_count' in completion_definition) = 0 then
    raise exception 'Completion does not compare the completed exercise count against required_exercise_count';
  end if;

  -- Regression guard for the SQLSTATE 42702 ambiguity fixed by
  -- 20260925000400: the local variable must not share the column's name.
  if position('completed_exercise_count = completed_exercise_count' in completion_definition) > 0 then
    raise exception 'complete_method_session_v2 has an ambiguous variable/column reference again';
  end if;
  if position('completed_exercise_count = completed_count' in completion_definition) = 0 then
    raise exception 'complete_method_session_v2 no longer persists the completed exercise count';
  end if;
  if position('''completed_exercise_count'', completed_count' in completion_definition) = 0 then
    raise exception 'The completed_exercise_count response key was renamed; consumers would break';
  end if;

  -- §5 / §8: the legacy 60-minute default must still exist for snapshot-less rows.
  if position('''profile_default''' in completion_definition) > 0 then
    raise exception 'Completion should not re-derive the selection source';
  end if;

  -- ---------------------------------------------------------------------
  -- §7: mid-session shortening recomputes the threshold for an active session
  -- ---------------------------------------------------------------------
  if position('selected_session_minutes = p_selected_session_minutes' in duration_definition) = 0 then
    raise exception 'Duration change does not update selected_session_minutes';
  end if;
  if position('required_exercise_count = recomputed_required_count' in duration_definition) = 0 then
    raise exception 'Duration change does not recompute required_exercise_count';
  end if;
  if position('status <> ''started''' in duration_definition) = 0 then
    raise exception 'Duration change does not restrict itself to active sessions';
  end if;
end;
$$;

rollback;
