begin;

do $test$
declare
  target_release_id uuid;
  template_count integer;
begin
  select id into target_release_id
  from public.method_releases
  where version = '1.2'
    and workbook_checksum_sha256 = '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd';

  if to_regclass('public.method_runtime_set_templates') is null then
    raise exception 'runtime set template table is missing';
  end if;

  select count(*) into template_count
  from public.method_runtime_set_templates where method_release_id = target_release_id;
  if template_count <> 49 then
    raise exception 'expected 49 runtime set templates, found %', template_count;
  end if;

  if exists (
    select 1 from public.method_runtime_set_templates template
    join public.method_rules rule on rule.id = template.method_rule_id
    where template.method_release_id = target_release_id and rule.rule_key = 'RX-DAY2-04'
  ) then
    raise exception 'open-elbow row must not receive fabricated structured sets';
  end if;

  if not exists (
    select 1 from public.method_runtime_set_templates template
    join public.method_rules rule on rule.id = template.method_rule_id
    where template.method_release_id = target_release_id and rule.rule_key = 'RX-DAY1-01'
    group by rule.id
    having count(*) = 4
      and count(*) filter (where template.set_type = 'warmup' and template.target_reps_min = 15) = 1
      and count(*) filter (where template.set_type = 'working' and template.target_reps_min in (12,10,8)) = 3
  ) then
    raise exception 'bench warmup and 12/10/8 working plan is incomplete';
  end if;

  if exists (
    select 1
    from public.session_prescriptions session_plan
    join public.method_enrollments enrollment on enrollment.id = session_plan.enrollment_id
    join public.exercise_prescriptions exercise_plan on exercise_plan.session_prescription_id = session_plan.id
    join public.method_split_exercises split_exercise
      on split_exercise.method_split_id = session_plan.method_split_id
     and split_exercise.exercise_id = exercise_plan.exercise_id
    join public.method_rules rule
      on rule.method_release_id = enrollment.method_release_id
     and rule.rule_key = split_exercise.prescription_rule_key
    where enrollment.method_release_id = target_release_id
      and rule.rule_key <> 'RX-DAY2-04'
      and not exists (
        select 1 from public.set_prescriptions set_plan
        where set_plan.exercise_prescription_id = exercise_plan.id
      )
  ) then
    raise exception 'an existing structured exercise prescription is still missing sets';
  end if;

  if exists (
    select 1
    from public.workout_sessions workout
    join public.exercise_executions execution on execution.workout_session_id = workout.id
    join public.set_prescriptions set_plan on set_plan.exercise_prescription_id = execution.exercise_prescription_id
    where workout.status = 'started'
      and not exists (
        select 1 from public.set_executions set_actual
        where set_actual.exercise_execution_id = execution.id
          and set_actual.set_prescription_id = set_plan.id
      )
  ) then
    raise exception 'a started workout is missing repaired set executions';
  end if;

  if has_table_privilege('authenticated','public.method_runtime_set_templates','SELECT')
     or has_table_privilege('authenticated','public.method_runtime_set_templates','INSERT') then
    raise exception 'runtime set templates must remain server-only';
  end if;
end;
$test$;

rollback;
