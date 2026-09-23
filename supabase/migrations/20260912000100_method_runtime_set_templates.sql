-- Pawside 2.0 P0: runtime set templates for the active three-split Method.
-- Canonical content stays immutable; these rows project v1.2 summaries into
-- executable sets and keep product defaults explicitly labelled.

begin;

create table public.method_runtime_set_templates (
  id uuid primary key default gen_random_uuid(),
  method_release_id uuid not null references public.method_releases(id) on delete cascade,
  method_rule_id uuid not null references public.method_rules(id) on delete cascade,
  set_index integer not null check (set_index > 0),
  set_type text not null check (set_type in ('warmup', 'working', 'failure', 'rest_pause', 'backoff', 'other')),
  target_reps_min integer check (target_reps_min is null or target_reps_min >= 0),
  target_reps_max integer check (target_reps_max is null or target_reps_max >= 0),
  failure_allowed boolean not null default false,
  failure_required boolean not null default false,
  rest_min_seconds integer check (rest_min_seconds is null or rest_min_seconds >= 0),
  rest_max_seconds integer check (rest_max_seconds is null or rest_max_seconds >= 0),
  quality_requirement text,
  source_authority text not null,
  evidence_key text,
  created_at timestamptz not null default now(),
  unique(method_rule_id, set_index),
  check (target_reps_min is null or target_reps_max is null or target_reps_min <= target_reps_max),
  check (rest_min_seconds is null or rest_max_seconds is null or rest_min_seconds <= rest_max_seconds),
  check (not failure_required or failure_allowed)
);

create index method_runtime_set_templates_release_idx
  on public.method_runtime_set_templates(method_release_id, method_rule_id, set_index);

alter table public.method_runtime_set_templates enable row level security;
alter table public.method_runtime_set_templates force row level security;
revoke all on table public.method_runtime_set_templates from anon, authenticated;

with template_rows(rule_key, set_index, set_type, reps_min, reps_max, failure_allowed,
  rest_min, rest_max, quality_requirement, source_authority, evidence_key) as (
  values
    ('RX-DAY1-01',1,'warmup',15,15,false,null,null,'热身组','method_explicit','EV-BP-001'),
    ('RX-DAY1-01',2,'working',12,12,false,null,null,'正式组 1','method_explicit','EV-BP-001'),
    ('RX-DAY1-01',3,'working',10,10,false,null,null,'正式组 2','method_explicit','EV-BP-001'),
    ('RX-DAY1-01',4,'working',8,8,false,null,null,'正式组 3','method_explicit','EV-BP-001'),
    ('RX-DAY1-02',1,'working',12,12,false,null,null,null,'method_explicit','EV-INC-001'),
    ('RX-DAY1-02',2,'working',12,12,false,null,null,null,'method_explicit','EV-INC-001'),
    ('RX-DAY1-02',3,'working',12,12,false,null,null,null,'method_explicit','EV-INC-001'),
    ('RX-DAY1-02',4,'working',12,12,false,null,null,null,'method_explicit','EV-INC-001'),
    ('RX-DAY1-03',1,'working',12,12,true,null,null,'能力范围内以标准动作完成','method_explicit','EV-DIP-001'),
    ('RX-DAY1-03',2,'working',12,12,true,null,null,'能力范围内以标准动作完成','method_explicit','EV-DIP-001'),
    ('RX-DAY1-03',3,'working',12,12,true,null,null,'能力范围内以标准动作完成','method_explicit','EV-DIP-001'),
    ('RX-DAY1-03',4,'working',12,12,true,null,null,'能力范围内以标准动作完成','method_explicit','EV-DIP-001'),
    ('RX-DAY1-04',1,'working',15,15,false,null,null,null,'method_explicit','EV-TRI-001'),
    ('RX-DAY1-04',2,'working',15,15,false,null,null,null,'method_explicit','EV-TRI-001'),
    ('RX-DAY1-04',3,'working',15,15,false,null,null,null,'method_explicit','EV-TRI-001'),
    ('RX-DAY1-04',4,'working',15,15,false,null,null,null,'method_explicit','EV-TRI-001'),
    ('RX-DAY1-05',1,'rest_pause',20,20,true,5,5,'10 + 10 次；组内休息 5 秒','method_explicit','EV-LATRAISE-001'),
    ('RX-DAY1-05',2,'rest_pause',20,20,true,5,5,'10 + 10 次；组内休息 5 秒','method_explicit','EV-LATRAISE-001'),
    ('RX-DAY1-05',3,'rest_pause',20,20,true,5,5,'10 + 10 次；组内休息 5 秒','method_explicit','EV-LATRAISE-001'),
    ('RX-DAY2-01',1,'working',12,12,false,null,null,'前 3 组不力竭','method_explicit','EV-PULL-001'),
    ('RX-DAY2-01',2,'working',12,12,false,null,null,'前 3 组不力竭','method_explicit','EV-PULL-001'),
    ('RX-DAY2-01',3,'working',12,12,false,null,null,'前 3 组不力竭','method_explicit','EV-PULL-001'),
    ('RX-DAY2-01',4,'rest_pause',15,15,true,null,null,'末组 10 + 5 次','method_explicit','EV-PULL-001'),
    ('RX-DAY2-02',1,'working',8,12,false,null,null,null,'method_explicit','EV-PULL-002'),
    ('RX-DAY2-02',2,'working',8,12,false,null,null,null,'method_explicit','EV-PULL-002'),
    ('RX-DAY2-02',3,'working',8,12,false,null,null,null,'method_explicit','EV-PULL-002'),
    ('RX-DAY2-02',4,'working',8,12,false,null,null,null,'method_explicit','EV-PULL-002'),
    ('RX-DAY2-03',1,'working',10,10,false,null,null,'前 3 组不力竭','method_explicit','EV-ROW-001'),
    ('RX-DAY2-03',2,'working',10,10,false,null,null,'前 3 组不力竭','method_explicit','EV-ROW-001'),
    ('RX-DAY2-03',3,'working',10,10,false,null,null,'前 3 组不力竭','method_explicit','EV-ROW-001'),
    ('RX-DAY2-03',4,'rest_pause',15,15,true,null,null,'末组 10 + 5 次','method_explicit','EV-ROW-001'),
    ('RX-DAY2-05',1,'working',12,15,false,null,null,'运行时默认；不得表述为作者原始处方','product_execution_default','EV-P0-CURL-DEFAULT'),
    ('RX-DAY2-05',2,'working',12,15,false,null,null,'运行时默认；不得表述为作者原始处方','product_execution_default','EV-P0-CURL-DEFAULT'),
    ('RX-DAY2-05',3,'working',12,15,false,null,null,'运行时默认；不得表述为作者原始处方','product_execution_default','EV-P0-CURL-DEFAULT'),
    ('RX-DAY3-01',1,'working',12,12,false,null,null,'每侧；运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-01',2,'working',12,12,false,null,null,'每侧；运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-01',3,'working',12,12,false,null,null,'每侧；运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-02',1,'working',10,12,false,null,null,'每侧；运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-02',2,'working',10,12,false,null,null,'每侧；运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-02',3,'working',10,12,false,null,null,'每侧；运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-03',1,'working',12,15,false,null,null,'运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-03',2,'working',12,15,false,null,null,'运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-03',3,'working',12,15,false,null,null,'运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-04',1,'working',10,12,false,null,null,'运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-04',2,'working',10,12,false,null,null,'运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-04',3,'working',10,12,false,null,null,'运行时默认','product_execution_default','EV-P0-DAY3-DEFAULT'),
    ('RX-DAY3-05',1,'working',8,8,false,null,null,null,'method_explicit','EV-LOWER-001'),
    ('RX-DAY3-05',2,'working',8,8,false,null,null,null,'method_explicit','EV-LOWER-001'),
    ('RX-DAY3-05',3,'working',8,8,false,null,null,null,'method_explicit','EV-LOWER-001')
)
insert into public.method_runtime_set_templates (
  method_release_id, method_rule_id, set_index, set_type, target_reps_min,
  target_reps_max, failure_allowed, rest_min_seconds, rest_max_seconds,
  quality_requirement, source_authority, evidence_key
)
select release.id, rule.id, template.set_index, template.set_type,
  template.reps_min, template.reps_max, template.failure_allowed,
  template.rest_min, template.rest_max, template.quality_requirement,
  template.source_authority, template.evidence_key
from template_rows template
join public.method_releases release
  on release.version = '1.2'
 and release.workbook_checksum_sha256 = '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd'
join public.method_rules rule
  on rule.method_release_id = release.id and rule.rule_key = template.rule_key
on conflict (method_rule_id, set_index) do nothing;

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
    rest_max_seconds, quality_requirement
  )
  select exercise_prescription.id, template.set_index, template.set_type,
    template.target_reps_min, template.target_reps_max, null, null,
    template.failure_allowed, template.failure_required, null,
    template.rest_min_seconds, template.rest_max_seconds, template.quality_requirement
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
  return created_prescription_id;
end;
$$;

revoke all on function public.create_session_prescription_for_cycle(uuid)
  from public, anon, authenticated;

insert into public.set_prescriptions (
  exercise_prescription_id, set_index, set_type, target_reps_min,
  target_reps_max, target_rpe, target_rir, failure_allowed,
  failure_required, target_weight_kg, rest_min_seconds,
  rest_max_seconds, quality_requirement
)
select exercise_prescription.id, template.set_index, template.set_type,
  template.target_reps_min, template.target_reps_max, null, null,
  template.failure_allowed, template.failure_required, null,
  template.rest_min_seconds, template.rest_max_seconds, template.quality_requirement
from public.exercise_prescriptions exercise_prescription
join public.session_prescriptions session_plan on session_plan.id = exercise_prescription.session_prescription_id
join public.method_enrollments enrollment on enrollment.id = session_plan.enrollment_id
join public.method_split_exercises split_exercise
  on split_exercise.method_split_id = session_plan.method_split_id
 and split_exercise.exercise_id = exercise_prescription.exercise_id
join public.method_rules rule
  on rule.method_release_id = enrollment.method_release_id
 and rule.rule_key = split_exercise.prescription_rule_key
join public.method_runtime_set_templates template on template.method_rule_id = rule.id
on conflict (exercise_prescription_id, set_index) do nothing;

insert into public.set_executions (
  user_id, workout_session_id, exercise_execution_id, set_prescription_id,
  set_index, status, is_extra
)
select workout.user_id, workout.id, execution.id, set_plan.id,
  set_plan.set_index, 'planned', false
from public.workout_sessions workout
join public.exercise_executions execution on execution.workout_session_id = workout.id
join public.set_prescriptions set_plan
  on set_plan.exercise_prescription_id = execution.exercise_prescription_id
where workout.status = 'started'
on conflict (exercise_execution_id, set_index) do nothing;

comment on table public.method_runtime_set_templates is
  'Runtime projection of immutable Canonical Method summaries. Product defaults remain labelled and Strict Method blockers remain unchanged.';
comment on function public.create_session_prescription_for_cycle(uuid) is
  'Creates an open Method prescription from runtime set templates, with structured-field fallback for future releases.';

commit;
