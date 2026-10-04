-- Four-split method release 1.1: adds plank (seconds) to the core day and a cardio
-- day (time + distance). An active release is immutable, so 1.1 is a new release
-- built as a copy of 1.0 plus the additions; 1.0 is retired once 1.1 is active.
--
-- Needs 20261004000700 (record shapes). Refuses to run if anyone is still enrolled
-- on 1.0, because a retired release cannot generate prescriptions.
--
-- Online execution requires Sylvan's go-ahead.

begin;

insert into public.exercises (canonical_name_zh, movement_pattern, target_regions, equipment, record_shape)
values
  ('平板支撑',   'core',   array['腹','核心'], array['自重'], 'duration'),
  ('跑步机慢跑', 'cardio', array['心肺'],      array['跑步机'], 'distance_duration')
on conflict (canonical_name_zh) do nothing;

-- Exercises introduced by 1.0 that are bodyweight movements (no user data exists for them yet).
update public.exercises
set record_shape = 'bodyweight_reps'
where canonical_name_zh in ('窄距俯卧撑', '卷腹', '悬垂举腿', '反向卷腹', '罗马椅挺身')
  and record_shape = 'weight_reps';

insert into public.exercise_external_mappings (
  exercise_id, provider, external_slug, source_version, license, attribution,
  source_url, mapping_status, mapping_notes, reviewed_at
)
select e.id, '@bryllim/workout-guide', seed.external_slug, '1.0.0', 'CC BY-SA 4.0',
  'Original exercise artwork by Everkinetic, expanded by Bryl Lim, licensed under CC BY-SA 4.0.',
  'https://bryllim.github.io/workout-guide/exercises/' || seed.external_slug || '/',
  'confirmed', seed.notes, now()
from (values
  ('平板支撑',   'plank',   'Exact forearm plank match.'),
  ('跑步机慢跑', 'running', 'Treadmill running match.')
) as seed(name, external_slug, notes)
join public.exercises e on e.canonical_name_zh = seed.name
on conflict (exercise_id, provider, source_version) do nothing;

do $release$
declare
  target_method_id uuid;
  r10 uuid;
  r11 uuid;
begin
  select m.id into target_method_id from public.methods m where m.key = 'four_split_2026' and m.version = '1.0';
  select r.id into r10 from public.method_releases r where r.method_id = target_method_id and r.version = '1.0';
  if r10 is null then raise exception 'four_split_2026 release 1.0 is missing'; end if;
  if exists (select 1 from public.method_releases r where r.method_id = target_method_id and r.version = '1.1') then
    raise exception 'four_split_2026 release 1.1 already exists';
  end if;
  if exists (select 1 from public.method_enrollments e where e.method_release_id = r10 and e.status in ('active', 'paused')) then
    raise exception 'someone is still enrolled on four_split_2026 1.0; migrate them before retiring it';
  end if;

  insert into public.method_releases (
    method_id, version, status, release_channel, release_policy,
    runtime_gate_status, strict_gate_status, validation_report_json, release_notes, validated_at
  )
  select method_id, '1.1', 'validated', release_channel, release_policy,
    runtime_gate_status, strict_gate_status, validation_report_json,
    '四分化 1.1：在 1.0 的基础上，腹肌日加入平板支撑（按秒记录），新增可选有氧日（按时间和距离记录）。',
    now()
  from public.method_releases where id = r10
  returning id into r11;

  insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index, primary_focus, description, day_type, is_required)
  select method_id, r11, key, name_zh, order_index, primary_focus, description, day_type, is_required
  from public.method_splits where method_release_id = r10;

  insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index, primary_focus, description, day_type, is_required)
  values (target_method_id, r11, 'cardio', '有氧', 6, array['心肺'], '可选：有氧日，记录时间和距离，不计入一轮完成', 'cardio', false);

  insert into public.method_rules (
    method_id, method_release_id, rule_key, rule_type, version, config_json, explanation_zh,
    status, source_authority, runtime_status, confidence, source_note, canonical_status,
    evidence_required, config_schema_version
  )
  select method_id, r11, rule_key, rule_type, '1.1', config_json, explanation_zh,
    status, source_authority, runtime_status, confidence, source_note, canonical_status,
    evidence_required, config_schema_version
  from public.method_rules where method_release_id = r10;

  insert into public.method_rules (
    method_id, method_release_id, rule_key, rule_type, version, config_json, explanation_zh,
    status, source_authority, runtime_status, confidence, source_note, canonical_status,
    evidence_required, config_schema_version
  )
  values
    (target_method_id, r11, 'FS-CORE-04', 'prescription', '1.1',
     jsonb_build_object('schema', 'canonical-prescription-summary-v1', 'summary_zh', '3 组 × 60 秒（通用攻略，初学者可从 30 秒开始）'),
     '3 组 × 60 秒（通用攻略，初学者可从 30 秒开始）', 'active', 'product_execution_default', 'fallback_active', 'medium',
     '组数和时长中有产品默认值，不要表述为作者原话。', 'active', false, 1),
    (target_method_id, r11, 'FS-CARDIO-01', 'prescription', '1.1',
     jsonb_build_object('schema', 'canonical-prescription-summary-v1', 'summary_zh', '30 分钟，强度以能说话为准（原文未规定）'),
     '30 分钟，强度以能说话为准（原文未规定）', 'active', 'product_execution_default', 'fallback_active', 'medium',
     '原文没有有氧安排；时长和强度是产品默认值。', 'active', false, 1);

  insert into public.method_split_exercises (
    method_split_id, exercise_id, order_index, method_role, prescription_rule_key,
    progression_rule_key, method_notes, field_provenance
  )
  select ns.id, se.exercise_id, se.order_index, se.method_role, se.prescription_rule_key,
    se.progression_rule_key, se.method_notes, se.field_provenance
  from public.method_split_exercises se
  join public.method_splits os on os.id = se.method_split_id and os.method_release_id = r10
  join public.method_splits ns on ns.method_release_id = r11 and ns.key = os.key;

  insert into public.method_split_exercises (
    method_split_id, exercise_id, order_index, method_role, prescription_rule_key,
    progression_rule_key, method_notes, field_provenance
  )
  select s.id, e.id, v.ord, v.role, v.rule_key, null, v.note,
    jsonb_build_object('prescription', jsonb_build_object('authority', 'product_execution_default'))
  from (values
    ('core',   4, '平板支撑',   'isolation', 'FS-CORE-04',   '3 组 × 60 秒（通用攻略，初学者可从 30 秒开始）'),
    ('cardio', 1, '跑步机慢跑', 'primary',   'FS-CARDIO-01', '30 分钟，强度以能说话为准（原文未规定）')
  ) as v(split_key, ord, name, role, rule_key, note)
  join public.method_splits s on s.method_release_id = r11 and s.key = v.split_key
  join public.exercises e on e.canonical_name_zh = v.name;

  insert into public.method_runtime_set_templates (
    method_release_id, method_rule_id, set_index, set_type, target_reps_min, target_reps_max,
    failure_allowed, failure_required, rest_min_seconds, rest_max_seconds, quality_requirement,
    source_authority, evidence_key, target_duration_seconds, target_distance_m
  )
  select r11, nr.id, t.set_index, t.set_type, t.target_reps_min, t.target_reps_max,
    t.failure_allowed, t.failure_required, t.rest_min_seconds, t.rest_max_seconds, t.quality_requirement,
    t.source_authority, t.evidence_key, t.target_duration_seconds, t.target_distance_m
  from public.method_runtime_set_templates t
  join public.method_rules orule on orule.id = t.method_rule_id
  join public.method_rules nr on nr.method_release_id = r11 and nr.rule_key = orule.rule_key
  where t.method_release_id = r10;

  insert into public.method_runtime_set_templates (
    method_release_id, method_rule_id, set_index, set_type, target_reps_min, target_reps_max,
    failure_allowed, failure_required, rest_min_seconds, rest_max_seconds, quality_requirement,
    source_authority, evidence_key, target_duration_seconds, target_distance_m
  )
  select r11, r.id, g.i, 'working', null, null, false, false, null, null, v.quality,
    'product_execution_default', null, v.seconds, null
  from (values
    ('FS-CORE-04',   3, 60,   '保持身体成一条直线；做不到 60 秒就记实际秒数'),
    ('FS-CARDIO-01', 1, 1800, '记录实际时间和距离；原文未规定，时长是参考')
  ) as v(rule_key, sets, seconds, quality)
  join public.method_rules r on r.method_release_id = r11 and r.rule_key = v.rule_key
  cross join lateral generate_series(1, v.sets) as g(i);

  -- one active release per (method, channel): retire 1.0 first, then activate 1.1
  update public.method_releases set status = 'retired', retired_at = now() where id = r10;
  update public.method_releases set status = 'active' where id = r11;
end;
$release$;

commit;
