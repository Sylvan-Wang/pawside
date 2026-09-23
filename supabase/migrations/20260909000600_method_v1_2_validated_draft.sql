-- Canonical Method Workbook v1.2 controlled import.
-- This migration creates a validated internal-beta draft. It never activates it.

begin;

do $import$
declare
  target_method_id uuid;
  target_run_id uuid;
  target_release_id uuid;
  existing_release_status text;
  catalog jsonb := '[
    {"split":"push","order":1,"name":"杠铃卧推","role":"primary","rx":"RX-DAY1-01","summary":"热身15次；正式组12/10/8次","authority":"method_explicit","evidence":["EV-BP-001","EV-BP-004"]},
    {"split":"push","order":2,"name":"上斜哑铃卧推","role":"secondary","rx":"RX-DAY1-02","summary":"4组×12次","authority":"method_explicit","evidence":["EV-INC-001"]},
    {"split":"push","order":3,"name":"双杠臂屈伸","role":"secondary","rx":"RX-DAY1-03","summary":"4组×12次或能力范围","authority":"method_explicit","evidence":["EV-DIP-001"]},
    {"split":"push","order":4,"name":"仰卧杠铃臂屈伸","role":"isolation","rx":"RX-DAY1-04","summary":"4组×15次","authority":"method_explicit","evidence":["EV-TRI-001"]},
    {"split":"push","order":5,"name":"Y 字侧平举","role":"isolation","rx":"RX-DAY1-05","summary":"3组×10+10次；组内休息5秒","authority":"method_explicit","evidence":["EV-LATRAISE-001","EV-OFF-V001"]},
    {"split":"pull","order":1,"name":"单手绳索下拉","role":"development","rx":"RX-DAY2-01","summary":"前3组×12次；末组10+5次","authority":"method_explicit","evidence":["EV-PULL-001"]},
    {"split":"pull","order":2,"name":"对握高位下拉","role":"secondary","rx":"RX-DAY2-02","summary":"4组×8–12次","authority":"method_explicit","evidence":["EV-PULL-002","EV-OFF-V008","EV-OFF-V002B"]},
    {"split":"pull","order":3,"name":"单手器械划船","role":"secondary","rx":"RX-DAY2-03","summary":"前3组×10次；末组10+5次","authority":"method_explicit","evidence":["EV-ROW-001"]},
    {"split":"pull","order":4,"name":"坐姿开肘划船","role":"development","rx":"RX-DAY2-04","summary":"组次待严格方法证据；当前不可生成结构化组次","authority":"method_explicit","evidence":["EV-ROW-002","EV-OFF-V007"]},
    {"split":"pull","order":5,"name":"坐姿肩屈位绳索弯举","role":"isolation","rx":"RX-DAY2-05","summary":"3组×12–15次","authority":"product_execution_default","evidence":["EV-CURL-001","EV-OFF-V006","EV-P0-CURL-DEFAULT"]},
    {"split":"legs","order":1,"name":"单腿硬拉","role":"development","rx":"RX-DAY3-01","summary":"3组×每侧12次","authority":"product_execution_default","evidence":["EV-LOWER-001","EV-P0-DAY3-DEFAULT"]},
    {"split":"legs","order":2,"name":"保加利亚分腿蹲","role":"development","rx":"RX-DAY3-02","summary":"3组×每侧10–12次","authority":"product_execution_default","evidence":["EV-LOWER-001","EV-P0-DAY3-DEFAULT"]},
    {"split":"legs","order":3,"name":"前蹲/颈前深蹲","role":"secondary","rx":"RX-DAY3-03","summary":"3组×12–15次","authority":"product_execution_default","evidence":["EV-LOWER-001","EV-OFF-V009","EV-P0-DAY3-DEFAULT"]},
    {"split":"legs","order":4,"name":"罗马尼亚硬拉","role":"secondary","rx":"RX-DAY3-04","summary":"3组×10–12次","authority":"product_execution_default","evidence":["EV-LOWER-001","EV-OFF-V009","EV-P0-DAY3-DEFAULT"]},
    {"split":"legs","order":5,"name":"山羊挺身","role":"accessory","rx":"RX-DAY3-05","summary":"3组×8次","authority":"method_explicit","evidence":["EV-LOWER-001","EV-OFF-V009"]}
  ]'::jsonb;
  defaults jsonb := '[
    {"name":"坐姿肩屈位绳索弯举","sets":3,"sets_authority":"method_explicit","reps_min":12,"reps_max":15,"per_side":false,"reps_authority":"product_execution_default","evidence":"EV-P0-CURL-DEFAULT"},
    {"name":"单腿硬拉","sets":3,"sets_authority":"product_execution_default","reps_min":12,"reps_max":12,"per_side":true,"reps_authority":"product_execution_default","evidence":"EV-P0-DAY3-DEFAULT"},
    {"name":"保加利亚分腿蹲","sets":3,"sets_authority":"product_execution_default","reps_min":10,"reps_max":12,"per_side":true,"reps_authority":"product_execution_default","evidence":"EV-P0-DAY3-DEFAULT"},
    {"name":"前蹲/颈前深蹲","sets":3,"sets_authority":"method_explicit","reps_min":12,"reps_max":15,"per_side":false,"reps_authority":"product_execution_default","evidence":"EV-P0-DAY3-DEFAULT"},
    {"name":"罗马尼亚硬拉","sets":3,"sets_authority":"method_explicit","reps_min":10,"reps_max":12,"per_side":false,"reps_authority":"product_execution_default","evidence":"EV-P0-DAY3-DEFAULT"},
    {"name":"山羊挺身","sets":3,"sets_authority":"method_explicit","reps_min":8,"reps_max":8,"per_side":false,"reps_authority":"method_explicit","evidence":"EV-LOWER-001"}
  ]'::jsonb;
begin
  select id
  into target_method_id
  from public.methods
  where key = 'ksw_tcy_three_split_2026'
  order by created_at
  limit 1;

  if target_method_id is null then
    raise exception 'Pawside Method identity ksw_tcy_three_split_2026 is missing';
  end if;

  insert into public.method_source_documents (
    method_id,
    source_key,
    source_type,
    title,
    version,
    checksum_sha256,
    source_uri,
    status,
    metadata_json
  )
  values (
    target_method_id,
    'canonical-workbook',
    'workbook',
    'Pawside 三分化 Canonical Method Workbook',
    '1.2',
    '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd',
    'repo://outputs/method-p0-resolution/Pawside_三分化_Canonical_Method_Workbook_v1.2.xlsx',
    'ingested',
    jsonb_build_object(
      'runtime_gate', 'passed',
      'strict_gate', 'blocked',
      'source_role', 'canonical_import_input'
    )
  )
  on conflict (method_id, source_key, version, checksum_sha256) do nothing;

  select id, status
  into target_release_id, existing_release_status
  from public.method_releases
  where method_id = target_method_id and version = '1.2';

  if existing_release_status = 'active' then
    raise exception 'Method release 1.2 is already active and cannot be rewritten';
  end if;

  insert into public.canonical_import_runs (
    method_id,
    workbook_version,
    workbook_checksum_sha256,
    importer_version,
    status,
    validation_report_json,
    diff_json,
    row_counts_json,
    completed_at
  )
  select
    target_method_id,
    '1.2',
    '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd',
    '1.0.0',
    'validated',
    jsonb_build_object(
      'valid', true,
      'runtime_gate', 'passed',
      'strict_gate', 'blocked',
      'strict_blockers', jsonb_build_array('Q-001', 'Q-004')
    ),
    '{}'::jsonb,
    jsonb_build_object('plan_exercises', 15, 'p0_runtime_defaults', 6),
    now()
  where not exists (
    select 1
    from public.canonical_import_runs
    where method_id = target_method_id
      and workbook_checksum_sha256 = '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd'
      and importer_version = '1.0.0'
  )
  returning id into target_run_id;

  if target_run_id is null then
    select id
    into target_run_id
    from public.canonical_import_runs
    where method_id = target_method_id
      and workbook_checksum_sha256 = '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd'
      and importer_version = '1.0.0'
    order by started_at
    limit 1;
  end if;

  if target_release_id is null then
    insert into public.method_releases (
      method_id,
      version,
      status,
      release_channel,
      release_policy,
      runtime_gate_status,
      strict_gate_status,
      workbook_checksum_sha256,
      canonical_import_run_id,
      validation_report_json,
      release_notes,
      validated_at
    )
    values (
      target_method_id,
      '1.2',
      'validated',
      'internal_beta',
      'v1_runtime',
      'passed',
      'blocked',
      '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd',
      target_run_id,
      jsonb_build_object(
        'valid', true,
        'runtime_gate', 'passed',
        'strict_gate', 'blocked'
      ),
      'Validated internal-beta draft. Q-001 and Q-004 remain Strict Method blockers. Not activated.',
      now()
    )
    returning id into target_release_id;
  else
    update public.method_releases
    set status = 'validated',
        release_channel = 'internal_beta',
        release_policy = 'v1_runtime',
        runtime_gate_status = 'passed',
        strict_gate_status = 'blocked',
        workbook_checksum_sha256 = '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd',
        canonical_import_run_id = target_run_id,
        validation_report_json = jsonb_build_object(
          'valid', true,
          'runtime_gate', 'passed',
          'strict_gate', 'blocked'
        ),
        release_notes = 'Validated internal-beta draft. Q-001 and Q-004 remain Strict Method blockers. Not activated.',
        validated_at = coalesce(validated_at, now())
    where id = target_release_id;
  end if;

  update public.canonical_import_runs
  set release_id = target_release_id
  where id = target_run_id;

  insert into public.method_release_issues (
    method_release_id,
    issue_key,
    scope,
    status,
    blocks_v1_runtime_release,
    blocks_strict_method_release,
    resolution_json,
    source_note
  )
  values
    (
      target_release_id,
      'Q-001',
      'Day3 Strict Method Truth',
      'accepted_runtime_default',
      false,
      true,
      '{"runtime_resolution":"Pawside V1 field-level defaults","strict_resolution":"original or official exact prescription required"}'::jsonb,
      'Runtime may proceed with labelled defaults; Strict Method Certification remains blocked.'
    ),
    (
      target_release_id,
      'Q-004',
      'Cable Curl Strict Progression',
      'accepted_runtime_default',
      false,
      true,
      '{"runtime_resolution":"12–15 reps and calibration-only","strict_resolution":"official exact reps and progression required"}'::jsonb,
      'Calibration changes reference_weight only and never creates or advances method_stage.'
    )
  on conflict (method_release_id, issue_key) do update set
    scope = excluded.scope,
    status = excluded.status,
    blocks_v1_runtime_release = excluded.blocks_v1_runtime_release,
    blocks_strict_method_release = excluded.blocks_strict_method_release,
    resolution_json = excluded.resolution_json,
    source_note = excluded.source_note;

  insert into public.method_splits (
    method_id,
    method_release_id,
    key,
    name_zh,
    order_index,
    primary_focus,
    description
  )
  values
    (target_method_id, target_release_id, 'push', '推', 1, array['胸','三角肌中束','肱三头肌'], 'Day 1：胸 + 中束 + 三头'),
    (target_method_id, target_release_id, 'pull', '拉', 2, array['背','三角肌后束','肱二头肌'], 'Day 2：背 + 后束 + 二头'),
    (target_method_id, target_release_id, 'legs', '腿', 3, array['髋','臀','腘绳肌','股四头肌'], 'Day 3：下肢后侧链优先')
  on conflict (method_release_id, key) do update set
    name_zh = excluded.name_zh,
    order_index = excluded.order_index,
    primary_focus = excluded.primary_focus,
    description = excluded.description;

  insert into public.method_rules (
    method_id,
    method_release_id,
    rule_key,
    rule_type,
    version,
    config_json,
    explanation_zh,
    status,
    source_authority,
    runtime_status,
    confidence,
    source_note,
    canonical_status,
    evidence_required,
    config_schema_version
  )
  select
    target_method_id,
    target_release_id,
    item->>'rx',
    'prescription',
    '1.2',
    jsonb_build_object(
      'schema', 'canonical-prescription-summary-v1',
      'summary_zh', item->>'summary',
      'evidence_keys', item->'evidence',
      'structured_sets_available', item->>'name' <> '坐姿开肘划船'
    ),
    item->>'summary',
    'active',
    item->>'authority',
    case
      when item->>'authority' = 'product_execution_default' then 'fallback_active'
      else 'active'
    end,
    'high',
    case
      when item->>'authority' = 'product_execution_default'
        then 'Field-level mix includes Pawside V1 execution defaults; never present these values as author instructions.'
      else 'Canonical Workbook v1.2 method-explicit prescription.'
    end,
    'active',
    false,
    1
  from jsonb_array_elements(catalog) item
  on conflict (method_release_id, rule_key) do update set
    config_json = excluded.config_json,
    explanation_zh = excluded.explanation_zh,
    source_authority = excluded.source_authority,
    runtime_status = excluded.runtime_status,
    source_note = excluded.source_note,
    canonical_status = excluded.canonical_status;

  insert into public.method_split_exercises (
    method_split_id,
    exercise_id,
    order_index,
    method_role,
    prescription_rule_key,
    progression_rule_key,
    method_notes,
    field_provenance
  )
  select
    split.id,
    exercise.id,
    (item->>'order')::integer,
    item->>'role',
    item->>'rx',
    null,
    item->>'summary',
    jsonb_build_object(
      'prescription',
      jsonb_build_object(
        'authority', item->>'authority',
        'evidence_keys', item->'evidence'
      )
    )
  from jsonb_array_elements(catalog) item
  join public.method_splits split
    on split.method_release_id = target_release_id
   and split.key = item->>'split'
  join public.exercises exercise
    on exercise.canonical_name_zh = item->>'name'
  on conflict (method_split_id, exercise_id) do update set
    order_index = excluded.order_index,
    method_role = excluded.method_role,
    prescription_rule_key = excluded.prescription_rule_key,
    progression_rule_key = excluded.progression_rule_key,
    method_notes = excluded.method_notes,
    field_provenance = excluded.field_provenance;

  insert into public.method_prescription_field_values (
    method_split_exercise_id,
    method_rule_id,
    field_key,
    value_json,
    source_authority,
    runtime_status,
    confidence,
    evidence_key,
    source_note
  )
  select
    split_exercise.id,
    rule.id,
    field.field_key,
    field.value_json,
    field.authority,
    case when field.authority = 'product_execution_default' then 'fallback_active' else 'active' end,
    'high',
    item->>'evidence',
    case
      when field.authority = 'product_execution_default'
        then 'Pawside V1 execution default for runtime calibration; not an author-explicit value.'
      else 'Method-explicit field in Canonical Workbook v1.2.'
    end
  from jsonb_array_elements(defaults) item
  join public.exercises exercise on exercise.canonical_name_zh = item->>'name'
  join public.method_split_exercises split_exercise on split_exercise.exercise_id = exercise.id
  join public.method_splits split
    on split.id = split_exercise.method_split_id
   and split.method_release_id = target_release_id
  join public.method_rules rule
    on rule.method_release_id = target_release_id
   and rule.rule_key = split_exercise.prescription_rule_key
  cross join lateral (
    values
      (
        'sets',
        to_jsonb((item->>'sets')::integer),
        item->>'sets_authority'
      ),
      (
        'reps',
        jsonb_build_object(
          'min', (item->>'reps_min')::integer,
          'max', (item->>'reps_max')::integer,
          'per_side', (item->>'per_side')::boolean
        ),
        item->>'reps_authority'
      ),
      (
        'progression',
        '{"type":"calibration_only","method_stage":null}'::jsonb,
        'product_execution_default'
      )
  ) as field(field_key, value_json, authority)
  on conflict (method_split_exercise_id, field_key) do update set
    method_rule_id = excluded.method_rule_id,
    value_json = excluded.value_json,
    source_authority = excluded.source_authority,
    runtime_status = excluded.runtime_status,
    confidence = excluded.confidence,
    evidence_key = excluded.evidence_key,
    source_note = excluded.source_note;
end;
$import$;

commit;
