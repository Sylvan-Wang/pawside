-- Unblock unfinishable days, allow ending a day early, switch method from any day,
-- and raise an alert when a prescription would contain an exercise with no sets.
--
-- 1. 坐姿开肘划船 (method 1.2, pull day) had no set template, so a 60-minute pull day
--    could never reach 5/5. Sets are ADDED (3 × 10–15, product default from general
--    training guidance; existing rows are not touched) and ready prescriptions are
--    backfilled. Releases can no longer be activated with an exercise lacking sets.
-- 2. complete_method_session_v2 computes its threshold over countable exercises only.
-- 3. end_method_session_early_v1: closes a day keeping every recorded set, writes the
--    history entry, does NOT complete the day (the day can be redone, rotation unchanged).
-- 4. switch_method_release_v1(release, start_day): ends an open session early instead of
--    refusing, and lets the user pick which day to start from.
-- 5. system_alerts + report_missing_sets + owner-only reading via feature owner_console.
--
-- Online execution requires Sylvan's go-ahead.

begin;

-- ===== 1. missing set templates ============================================================
insert into public.method_runtime_set_templates (
  method_release_id, method_rule_id, set_index, set_type, target_reps_min, target_reps_max,
  failure_allowed, failure_required, rest_min_seconds, rest_max_seconds, quality_requirement,
  source_authority, evidence_key
)
select r.id, rule.id, g.i, 'working', 10, 15, false, false, 45, 90,
  '参考通用训练建议：3 组 × 10–15 次，肘部外展以上背发力',
  'product_execution_default', null
from public.method_releases r
join public.methods m on m.id = r.method_id and m.key = 'ksw_tcy_three_split_2026'
join public.method_rules rule on rule.method_release_id = r.id and rule.rule_key = 'RX-DAY2-04'
cross join generate_series(1, 3) as g(i)
where r.version = '1.2'
  and not exists (select 1 from public.method_runtime_set_templates t where t.method_rule_id = rule.id);

-- Prescriptions that are still ready (not started) get the same sets, so nobody hits the gap.
insert into public.set_prescriptions (
  exercise_prescription_id, set_index, set_type, target_reps_min, target_reps_max,
  failure_allowed, failure_required, rest_min_seconds, rest_max_seconds, quality_requirement
)
select ep.id, t.set_index, t.set_type, t.target_reps_min, t.target_reps_max,
  t.failure_allowed, t.failure_required, t.rest_min_seconds, t.rest_max_seconds, t.quality_requirement
from public.exercise_prescriptions ep
join public.session_prescriptions sp on sp.id = ep.session_prescription_id and sp.status in ('ready', 'upcoming')
join public.method_split_exercises se on se.exercise_id = ep.exercise_id
join public.method_splits s on s.id = se.method_split_id and s.id = sp.method_split_id
join public.method_rules rule on rule.method_release_id = s.method_release_id and rule.rule_key = se.prescription_rule_key
join public.method_runtime_set_templates t on t.method_rule_id = rule.id
where not exists (select 1 from public.set_prescriptions x where x.exercise_prescription_id = ep.id)
  and ep.status = 'not_started';

-- ===== activation guard ====================================================================
create or replace function public.validate_method_release_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  missing text;
begin
  if new.status = 'active' then
    if new.runtime_gate_status <> 'passed' then
      raise exception 'Runtime gate must pass before Method release activation';
    end if;

    if new.release_channel = 'production' and new.strict_gate_status <> 'passed' then
      raise exception 'Production activation requires Strict Method gate to pass';
    end if;

    if new.validated_at is null then
      raise exception 'Validated timestamp is required before activation';
    end if;

    if new.activated_at is null then
      new.activated_at := now();
    end if;

    if tg_op = 'INSERT' or old.status is distinct from 'active' then
      select string_agg(exercise.canonical_name_zh, '、') into missing
      from public.method_split_exercises se
      join public.method_splits s on s.id = se.method_split_id
      join public.exercises exercise on exercise.id = se.exercise_id
      where s.method_release_id = new.id
        and not exists (
          select 1 from public.method_runtime_set_templates t
          join public.method_rules rule on rule.id = t.method_rule_id
          where rule.method_release_id = new.id and rule.rule_key = se.prescription_rule_key
        )
        and not exists (
          select 1 from public.method_prescription_field_values f
          where f.method_split_exercise_id = se.id and f.field_key = 'sets'
        );
      if missing is not null then
        raise exception 'Method release has exercises without set templates: %', missing using errcode = '22023';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ===== 5. alerts ===========================================================================
insert into public.app_features (key, note)
values ('owner_console', '只有产品负责人可见的数据健康页')
on conflict (key) do nothing;

create table public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  dedupe_key text not null unique,
  summary text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  repair_prompt text,
  occurrences integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz
);
create index system_alerts_open_idx on public.system_alerts(status, last_seen desc);

alter table public.system_alerts enable row level security;
alter table public.system_alerts force row level security;
revoke all on table public.system_alerts from anon, authenticated;
grant select on table public.system_alerts to authenticated;
create policy system_alerts_owner_read on public.system_alerts
  for select to authenticated using (public.feature_enabled('owner_console'));

create function public.record_system_alert(
  p_kind text, p_dedupe_key text, p_summary text, p_details jsonb, p_repair_prompt text, p_severity text default 'warning'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.system_alerts (kind, severity, dedupe_key, summary, details, repair_prompt)
  values (p_kind, p_severity, p_dedupe_key, p_summary, coalesce(p_details, '{}'::jsonb), p_repair_prompt)
  on conflict (dedupe_key) do update set
    occurrences = public.system_alerts.occurrences + 1,
    last_seen = now(),
    status = 'open',
    resolved_at = null
$$;
revoke all on function public.record_system_alert(text, text, text, jsonb, text, text) from public, anon, authenticated;

create function public.report_missing_sets(p_prescription_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
begin
  for item in
    select exercise.id exercise_id, exercise.canonical_name_zh exercise_name,
           method.key method_key, release.id release_id, release.version release_version,
           prescription.split_key, se.prescription_rule_key rule_key
    from public.exercise_prescriptions ep
    join public.session_prescriptions prescription on prescription.id = ep.session_prescription_id
    join public.exercises exercise on exercise.id = ep.exercise_id
    join public.method_enrollments enrollment on enrollment.id = prescription.enrollment_id
    join public.method_releases release on release.id = enrollment.method_release_id
    join public.methods method on method.id = release.method_id
    left join public.method_split_exercises se on se.method_split_id = prescription.method_split_id and se.exercise_id = ep.exercise_id
    where ep.session_prescription_id = p_prescription_id
      and not exists (select 1 from public.set_prescriptions sp where sp.exercise_prescription_id = ep.id)
  loop
    perform public.record_system_alert(
      'prescription_missing_sets',
      'missing_sets:' || item.release_id || ':' || item.exercise_id,
      '动作「' || item.exercise_name || '」在方法 ' || item.method_key || ' ' || item.release_version || '（' || item.split_key || '）里没有组次',
      jsonb_build_object('method_key', item.method_key, 'release_version', item.release_version,
        'split_key', item.split_key, 'exercise', item.exercise_name, 'rule_key', item.rule_key),
      '请为方法 ' || item.method_key || ' 版本 ' || item.release_version || ' 的动作「' || item.exercise_name
        || '」补齐组次：1）联网查这个动作的组数、次数和组间休息的依据；2）在 method_runtime_set_templates 里为规则 '
        || coalesce(item.rule_key, '(未知)') || ' 新增行（set_type=working，source_authority=product_execution_default，标注来源），不要修改已有行；'
        || '3）对仍是 ready 的处方补写 set_prescriptions；4）在本地用 supabase/tests 的合约验证后再上线；5）在数据健康页点“已处理”。',
      'critical'
    );
  end loop;
end;
$$;
revoke all on function public.report_missing_sets(uuid) from public, anon, authenticated;

create function public.resolve_system_alert(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.feature_enabled('owner_console') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.system_alerts set status = 'resolved', resolved_at = now() where id = p_id;
end;
$$;
revoke all on function public.resolve_system_alert(uuid) from public, anon;
grant execute on function public.resolve_system_alert(uuid) to authenticated;

-- ===== prescription generators (report gaps) and completion (countable threshold) ============
create or replace function public.create_session_prescription_for_cycle(p_cycle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  target_enrollment_id uuid;
  target_release_id uuid;
  target_split_key text;
  target_split_id uuid;
  target_rule_version text;
  existing_prescription_id uuid;
  created_prescription_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cycle_id::text, 0));
  select enrollment.user_id, enrollment.id, enrollment.method_release_id, enrollment.next_split_key
  into target_user_id, target_enrollment_id, target_release_id, target_split_key
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  where cycle.id = p_cycle_id and cycle.status = 'in_progress' and enrollment.status = 'active';
  if target_enrollment_id is null then return null; end if;

  select prescription.id into existing_prescription_id
  from public.session_prescriptions prescription
  where prescription.enrollment_id = target_enrollment_id and prescription.cycle_id = p_cycle_id
    and prescription.split_key = target_split_key
    and prescription.status in ('upcoming', 'ready', 'started', 'rest_deferred')
  limit 1;
  if existing_prescription_id is not null then return existing_prescription_id; end if;

  select split.id, release.version into target_split_id, target_rule_version
  from public.method_splits split
  join public.method_releases release on release.id = split.method_release_id
  where split.method_release_id = target_release_id and split.key = target_split_key
    and release.status = 'active' and release.runtime_gate_status = 'passed';
  if target_split_id is null then
    raise exception 'Active Method split is unavailable for cycle %', p_cycle_id;
  end if;

  insert into public.session_prescriptions (
    user_id, enrollment_id, cycle_id, method_split_id, split_key,
    planned_for_date, status, generated_from_rule_version
  ) values (
    target_user_id, target_enrollment_id, p_cycle_id, target_split_id,
    target_split_key, current_date, 'ready', target_rule_version
  ) returning id into created_prescription_id;

  insert into public.exercise_prescriptions (
    session_prescription_id, exercise_id, order_index, method_role,
    progression_stage_key, target_summary_zh, target_weight_kg,
    weight_guidance_type, status
  )
  select created_prescription_id, split_exercise.exercise_id, split_exercise.order_index,
    split_exercise.method_role, 'calibration',
    coalesce(rule.config_json->>'summary_zh', split_exercise.method_notes),
    null, 'calibration', 'not_started'
  from public.method_split_exercises split_exercise
  left join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  where split_exercise.method_split_id = target_split_id
  order by split_exercise.order_index;

  insert into public.set_prescriptions (
    exercise_prescription_id, set_index, set_type, target_reps_min,
    target_reps_max, target_rpe, target_rir, failure_allowed,
    failure_required, target_weight_kg, rest_min_seconds,
    rest_max_seconds, quality_requirement,
    target_duration_seconds, target_distance_m
  )
  select exercise_prescription.id, template.set_index, template.set_type,
    template.target_reps_min, template.target_reps_max, null, null,
    template.failure_allowed, template.failure_required, null,
    template.rest_min_seconds, template.rest_max_seconds, template.quality_requirement,
    template.target_duration_seconds, template.target_distance_m
  from public.exercise_prescriptions exercise_prescription
  join public.method_split_exercises split_exercise
    on split_exercise.method_split_id = target_split_id
   and split_exercise.exercise_id = exercise_prescription.exercise_id
  join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  join public.method_runtime_set_templates template on template.method_rule_id = rule.id
  where exercise_prescription.session_prescription_id = created_prescription_id;

  insert into public.set_prescriptions (
    exercise_prescription_id, set_index, set_type, target_reps_min,
    target_reps_max, target_rpe, target_rir, failure_allowed,
    failure_required, target_weight_kg, rest_min_seconds,
    rest_max_seconds, quality_requirement
  )
  select exercise_prescription.id, set_number.index, 'working',
    (reps.value_json->>'min')::integer, (reps.value_json->>'max')::integer,
    null, null, false, false, null, null, null, null
  from public.exercise_prescriptions exercise_prescription
  join public.method_split_exercises split_exercise
    on split_exercise.method_split_id = target_split_id
   and split_exercise.exercise_id = exercise_prescription.exercise_id
  join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  join public.method_prescription_field_values sets
    on sets.method_split_exercise_id = split_exercise.id
   and sets.field_key = 'sets' and sets.runtime_status in ('active', 'fallback_active')
  join public.method_prescription_field_values reps
    on reps.method_split_exercise_id = split_exercise.id
   and reps.field_key = 'reps' and reps.runtime_status in ('active', 'fallback_active')
  cross join lateral generate_series(1, greatest((sets.value_json #>> '{}')::integer, 1)) set_number(index)
  where exercise_prescription.session_prescription_id = created_prescription_id
    and not exists (
      select 1 from public.method_runtime_set_templates template
      where template.method_rule_id = rule.id
    );
  perform public.report_missing_sets(created_prescription_id);
  return created_prescription_id;
end;
$$;

create or replace function public.create_program_day_prescription(
  p_cycle_id uuid,
  p_split_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  target_enrollment_id uuid;
  target_release_id uuid;
  target_split_id uuid;
  target_rule_version text;
  existing_prescription_id uuid;
  created_prescription_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_split_key is null or p_split_key !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'Invalid Program Day' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cycle_id::text, 0));

  select enrollment.user_id, enrollment.id, enrollment.method_release_id
  into target_user_id, target_enrollment_id, target_release_id
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  where cycle.id = p_cycle_id
    and cycle.status = 'in_progress'
    and enrollment.status = 'active'
    and enrollment.user_id = current_user_id;
  if target_enrollment_id is null then return null; end if;

  -- Idempotent: an existing Day of this cycle is never regenerated.
  select prescription.id into existing_prescription_id
  from public.session_prescriptions prescription
  where prescription.enrollment_id = target_enrollment_id
    and prescription.cycle_id = p_cycle_id
    and prescription.split_key = p_split_key
    and prescription.status <> 'cancelled'
  order by prescription.generated_at desc
  limit 1;
  if existing_prescription_id is not null then return existing_prescription_id; end if;

  select split.id, release.version into target_split_id, target_rule_version
  from public.method_splits split
  join public.method_releases release on release.id = split.method_release_id
  where split.method_release_id = target_release_id and split.key = p_split_key
    and release.status = 'active' and release.runtime_gate_status = 'passed';
  if target_split_id is null then
    raise exception 'Active Method split is unavailable for cycle %', p_cycle_id;
  end if;

  insert into public.session_prescriptions (
    user_id, enrollment_id, cycle_id, method_split_id, split_key,
    planned_for_date, status, generated_from_rule_version
  ) values (
    target_user_id, target_enrollment_id, p_cycle_id, target_split_id,
    p_split_key, current_date, 'ready', target_rule_version
  ) returning id into created_prescription_id;

  insert into public.exercise_prescriptions (
    session_prescription_id, exercise_id, order_index, method_role,
    progression_stage_key, target_summary_zh, target_weight_kg,
    weight_guidance_type, status
  )
  select created_prescription_id, split_exercise.exercise_id, split_exercise.order_index,
    split_exercise.method_role, 'calibration',
    coalesce(rule.config_json->>'summary_zh', split_exercise.method_notes),
    null, 'calibration', 'not_started'
  from public.method_split_exercises split_exercise
  left join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  where split_exercise.method_split_id = target_split_id
  order by split_exercise.order_index;

  insert into public.set_prescriptions (
    exercise_prescription_id, set_index, set_type, target_reps_min,
    target_reps_max, target_rpe, target_rir, failure_allowed,
    failure_required, target_weight_kg, rest_min_seconds,
    rest_max_seconds, quality_requirement,
    target_duration_seconds, target_distance_m
  )
  select exercise_prescription.id, template.set_index, template.set_type,
    template.target_reps_min, template.target_reps_max, null, null,
    template.failure_allowed, template.failure_required, null,
    template.rest_min_seconds, template.rest_max_seconds, template.quality_requirement,
    template.target_duration_seconds, template.target_distance_m
  from public.exercise_prescriptions exercise_prescription
  join public.method_split_exercises split_exercise
    on split_exercise.method_split_id = target_split_id
   and split_exercise.exercise_id = exercise_prescription.exercise_id
  join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  join public.method_runtime_set_templates template on template.method_rule_id = rule.id
  where exercise_prescription.session_prescription_id = created_prescription_id;

  insert into public.set_prescriptions (
    exercise_prescription_id, set_index, set_type, target_reps_min,
    target_reps_max, target_rpe, target_rir, failure_allowed,
    failure_required, target_weight_kg, rest_min_seconds,
    rest_max_seconds, quality_requirement
  )
  select exercise_prescription.id, set_number.index, 'working',
    (reps.value_json->>'min')::integer, (reps.value_json->>'max')::integer,
    null, null, false, false, null, null, null, null
  from public.exercise_prescriptions exercise_prescription
  join public.method_split_exercises split_exercise
    on split_exercise.method_split_id = target_split_id
   and split_exercise.exercise_id = exercise_prescription.exercise_id
  join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  join public.method_prescription_field_values sets
    on sets.method_split_exercise_id = split_exercise.id
   and sets.field_key = 'sets' and sets.runtime_status in ('active', 'fallback_active')
  join public.method_prescription_field_values reps
    on reps.method_split_exercise_id = split_exercise.id
   and reps.field_key = 'reps' and reps.runtime_status in ('active', 'fallback_active')
  cross join lateral generate_series(1, greatest((sets.value_json #>> '{}')::integer, 1)) set_number(index)
  where exercise_prescription.session_prescription_id = created_prescription_id
    and not exists (
      select 1 from public.method_runtime_set_templates template
      where template.method_rule_id = rule.id
    );

  perform public.report_missing_sets(created_prescription_id);
  return created_prescription_id;
end;
$$;

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
  countable_exercise_count integer;
  completed_count integer;
  completed_set_count integer;
  required_exercise_count integer;
  original_exercise_count integer;
  actual_duration integer;
  set_span_minutes integer;
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
  from (
    select split.key as split_key, split.order_index as ord
    from public.method_enrollments enrollment
    join public.method_splits split on split.method_release_id = enrollment.method_release_id
    where enrollment.id = target_session.enrollment_id and split.is_required
  ) as candidate
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

  -- An exercise without any set prescription can never count; it must not make the
  -- day impossible to finish, so the threshold is computed over countable exercises.
  select count(*) into countable_exercise_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id
    and exists (
      select 1 from public.set_prescriptions set_plan
      where set_plan.exercise_prescription_id = execution.exercise_prescription_id
    );

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
            countable_exercise_count,
            ceil(countable_exercise_count * target_session.selected_session_minutes / 60.0)::integer
          )
        else countable_exercise_count
      end
    );
    required_exercise_count := least(required_exercise_count, countable_exercise_count);
    if countable_exercise_count = 0 and completed_set_count < 1 then
      raise exception 'At least one persisted set actual is required' using errcode = '22023';
    end if;
    if completed_count < required_exercise_count then
      raise exception 'Session completion threshold not reached' using errcode = '22023';
    end if;
  end if;

  -- Patch B · B5 (D1): first completed set -> last completed set when there
  -- are at least two; a session merely left open for days no longer inherits
  -- that gap as its duration. Fewer than two sets has no span to measure, so
  -- it keeps the previous basis unchanged.
  if completed_set_count >= 2 then
    select ceil(extract(epoch from (max(set_actual.completed_at) - min(set_actual.completed_at))) / 60.0)::integer
    into set_span_minutes
    from public.set_executions set_actual
    where set_actual.workout_session_id = p_session_id
      and set_actual.status = 'completed';

    actual_duration := case
      when set_span_minutes > 150 then null
      else greatest(set_span_minutes, 1)
    end;
  else
    actual_duration := greatest(
      coalesce(p_duration_minutes, ceil(extract(epoch from (now() - target_session.started_at)) / 60.0)::integer),
      1
    );
  end if;

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
          'extra', set_actual.is_extra,
          'duration_seconds', set_actual.actual_duration_seconds,
          'distance_m', set_actual.actual_distance_m
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
    coalesce(public.workout_log_type_for_split(target_session.enrollment_id, target_session.split_key), target_session.split_key),
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
  from (
    select split.key as split_key, split.order_index as ord
    from public.method_enrollments enrollment
    join public.method_splits split on split.method_release_id = enrollment.method_release_id
    where enrollment.id = target_session.enrollment_id and split.is_required
  ) as candidate
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
        next_split_key = coalesce(public.first_required_split_key(target_session.enrollment_id), 'push'),
        current_state = 'ready'
    where id = target_session.enrollment_id
    returning current_cycle_number, next_split_key into next_cycle_number, next_split;

    insert into public.method_cycles (enrollment_id, cycle_number, status)
    values (target_session.enrollment_id, next_cycle_number, 'in_progress')
    returning id into new_cycle_id;

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
revoke all on function public.create_session_prescription_for_cycle(uuid) from public, anon, authenticated;
revoke all on function public.create_program_day_prescription(uuid, text) from public, anon;
grant execute on function public.create_program_day_prescription(uuid, text) to authenticated;
revoke all on function public.complete_method_session_v2(uuid, uuid, integer, text) from public, anon;
grant execute on function public.complete_method_session_v2(uuid, uuid, integer, text) to authenticated;

-- ===== 3. ending a day early ===============================================================
create function public.end_session_early_internal(p_user_id uuid, p_session_id uuid, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session record;
  completed_set_count integer;
  completed_count integer;
  set_span_minutes integer;
  ended_duration integer;
  legacy_exercises jsonb;
  logged boolean := false;
begin
  select session.id, session.user_id, session.session_prescription_id, session.enrollment_id,
         session.split_key, session.status, session.log_date
  into target_session
  from public.workout_sessions session
  where session.id = p_session_id and session.user_id = p_user_id
  for update;

  if target_session.id is null then
    raise exception 'Training session not found' using errcode = 'P0002';
  end if;
  if target_session.status = 'completed' then
    return jsonb_build_object('session_id', p_session_id, 'status', 'completed', 'idempotent', true);
  end if;

  select count(*) into completed_set_count
  from public.set_executions set_actual
  where set_actual.workout_session_id = p_session_id and set_actual.status = 'completed';

  select count(*) into completed_count
  from public.exercise_executions execution
  where execution.workout_session_id = p_session_id
    and exists (select 1 from public.set_prescriptions set_plan where set_plan.exercise_prescription_id = execution.exercise_prescription_id)
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

  -- Duration is only meaningful with two or more recorded sets (first to last).
  if completed_set_count >= 2 then
    select ceil(extract(epoch from (max(set_actual.completed_at) - min(set_actual.completed_at))) / 60.0)::integer
    into set_span_minutes
    from public.set_executions set_actual
    where set_actual.workout_session_id = p_session_id and set_actual.status = 'completed';
    ended_duration := case when set_span_minutes > 150 then null else greatest(set_span_minutes, 1) end;
  end if;

  update public.exercise_executions execution
  set status = 'completed'
  where execution.workout_session_id = p_session_id
    and exists (select 1 from public.set_prescriptions set_plan where set_plan.exercise_prescription_id = execution.exercise_prescription_id)
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
      duration_minutes = ended_duration,
      notes = p_notes,
      completion_rule_version = 'ended_early_v1',
      completion_policy_version = 'ended_early_v1',
      completed_exercise_count = completed_count
  where id = p_session_id;

  if completed_set_count > 0 then
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
            'extra', set_actual.is_extra,
            'duration_seconds', set_actual.actual_duration_seconds,
            'distance_m', set_actual.actual_distance_m
          ) order by set_actual.set_index), '[]'::jsonb)
          from public.set_executions set_actual
          where set_actual.exercise_execution_id = execution.id and set_actual.status = 'completed'
        )
      ) order by execution.order_index
    ), '[]'::jsonb)
    into legacy_exercises
    from public.exercise_executions execution
    join public.exercises exercise on exercise.id = execution.exercise_id
    where execution.workout_session_id = p_session_id
      and exists (select 1 from public.set_executions set_actual
                  where set_actual.exercise_execution_id = execution.id and set_actual.status = 'completed');

    insert into public.workout_logs (
      user_id, date, type, duration_minutes, notes, exercises, method_workout_session_id
    ) values (
      p_user_id, target_session.log_date,
      coalesce(public.workout_log_type_for_split(target_session.enrollment_id, target_session.split_key), target_session.split_key),
      ended_duration, p_notes, legacy_exercises, p_session_id
    ) on conflict (method_workout_session_id) do nothing;
    logged := true;
  end if;

  -- The day is NOT completed: it can be started again, and the rotation does not move.
  update public.session_prescriptions
  set status = 'ready'
  where id = target_session.session_prescription_id and status = 'started';

  update public.method_enrollments
  set current_state = 'ready'
  where id = target_session.enrollment_id and current_state = 'session_in_progress';

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'completed',
    'ended_early', true,
    'idempotent', false,
    'logged', logged,
    'completed_set_count', completed_set_count,
    'completed_exercise_count', completed_count,
    'log_date', target_session.log_date
  );
end;
$$;
revoke all on function public.end_session_early_internal(uuid, uuid, text) from public, anon, authenticated;

create function public.end_method_session_early_v1(p_session_id uuid, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  return public.end_session_early_internal(current_user_id, p_session_id, p_notes);
end;
$$;
revoke all on function public.end_method_session_early_v1(uuid, text) from public, anon;
grant execute on function public.end_method_session_early_v1(uuid, text) to authenticated;

-- ===== 4. switching: end an open day, choose the start day ================================
-- The one-argument form stays (as a thin wrapper) so no function has to be dropped and
-- old callers keep working; the two-argument form has no default to avoid an ambiguous call.
create function public.switch_method_release_v1(p_release_id uuid, p_start_split_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_method_id uuid;
  target_method_name text;
  current_enrollment record;
  open_session record;
  first_split text;
  new_enrollment_id uuid;
  new_cycle_id uuid;
  ended_sessions integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select release.method_id, method.name into target_method_id, target_method_name
  from public.method_releases release
  join public.methods method on method.id = release.method_id
  where release.id = p_release_id
    and release.status = 'active'
    and release.runtime_gate_status = 'passed';
  if target_method_id is null then
    raise exception 'Method release is not available' using errcode = 'P0002';
  end if;

  if p_start_split_key is not null and not exists (
    select 1 from public.method_splits split
    where split.method_release_id = p_release_id and split.key = p_start_split_key
  ) then
    raise exception 'Unknown start day for this method' using errcode = '22023';
  end if;

  select enrollment.id, enrollment.method_release_id, enrollment.capability_profile_id,
         enrollment.adaptation_policy_release_id
  into current_enrollment
  from public.method_enrollments enrollment
  where enrollment.user_id = current_user_id and enrollment.status = 'active'
  for update;

  if current_enrollment.id is null then
    raise exception 'No active training method to switch from' using errcode = 'P0002';
  end if;

  if current_enrollment.method_release_id = p_release_id then
    return jsonb_build_object(
      'status', 'unchanged',
      'enrollment_id', current_enrollment.id,
      'method_release_id', p_release_id
    );
  end if;

  -- A day still open is closed with everything recorded so far (history keeps it).
  for open_session in
    select session.id from public.workout_sessions session
    where session.enrollment_id = current_enrollment.id and session.status = 'started'
  loop
    perform public.end_session_early_internal(current_user_id, open_session.id, null);
    ended_sessions := ended_sessions + 1;
  end loop;

  update public.session_prescriptions
  set status = 'cancelled'
  where enrollment_id = current_enrollment.id
    and status in ('upcoming', 'ready', 'rest_deferred');

  update public.method_enrollments
  set status = 'archived'
  where id = current_enrollment.id;

  insert into public.method_enrollments (
    user_id, method_id, method_release_id, capability_profile_id,
    adaptation_policy_release_id, status, current_cycle_number, next_split_key, current_state
  ) values (
    current_user_id, target_method_id, p_release_id, current_enrollment.capability_profile_id,
    current_enrollment.adaptation_policy_release_id, 'active', 1, 'push', 'ready'
  )
  returning id into new_enrollment_id;

  first_split := coalesce(p_start_split_key, public.first_required_split_key(new_enrollment_id));
  if first_split is null then
    raise exception 'Method release has no required training day' using errcode = '22023';
  end if;

  update public.method_enrollments
  set next_split_key = first_split
  where id = new_enrollment_id;

  -- The cycle insert fires method_cycles_generate_session_prescription, which
  -- materialises the prescription of next_split_key (the chosen start day).
  insert into public.method_cycles (enrollment_id, cycle_number, status)
  values (new_enrollment_id, 1, 'in_progress')
  returning id into new_cycle_id;

  return jsonb_build_object(
    'status', 'switched',
    'enrollment_id', new_enrollment_id,
    'previous_enrollment_id', current_enrollment.id,
    'method_release_id', p_release_id,
    'method_name', target_method_name,
    'cycle_id', new_cycle_id,
    'next_split_key', first_split,
    'ended_open_sessions', ended_sessions
  );
end;
$$;

revoke all on function public.switch_method_release_v1(uuid, text) from public, anon;
grant execute on function public.switch_method_release_v1(uuid, text) to authenticated;

create or replace function public.switch_method_release_v1(p_release_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.switch_method_release_v1(p_release_id, null::text)
$$;

comment on function public.switch_method_release_v1(uuid, text) is
  'Archives the active enrollment (closing an open day early, history kept) and enrolls the user in another active Method release, starting from the chosen day. Never deletes training history.';

commit;
