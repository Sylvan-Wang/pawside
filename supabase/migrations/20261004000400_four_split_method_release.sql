-- Four-split method release 1.0 (胸 / 背 / 腿 / 肩 + optional 腹肌日).
-- Additive: one new method, one new release, its splits / rules / set templates,
-- and new exercise identities. Existing methods, releases, exercises and user
-- rows are not touched. The release is created as 'validated', filled, and only
-- then activated (active releases are immutable).
--
-- Sources (user-supplied articles, Xiaoheihe 铁棍顶着门 series + 肩部入门文章):
--   胸日 = 四分化胸三头训练日；背日 = 背部计划 + 四分化推荐的面拉；
--   腿日 = 训练日 A；肩日 = 肩部入门文章的 4 个动作；
--   腹肌日 = 通用公开攻略（卷腹 / 悬垂举腿 / 反向卷腹），不是原文方法的一部分。
-- Where the source gives a range of sets ("3–4 组") the lower bound is used and the
-- field is labelled product_execution_default. Plank and cardio days are not
-- included yet: they need time/distance logging (see docs/method-import).
-- Rest days are a schedule suggestion, not a Program Day.

begin;

insert into public.exercises (canonical_name_zh, movement_pattern, target_regions, equipment)
values
  ('下斜器械卧推',   'push',  array['胸'],        array['器械']),
  ('哑铃平板卧推',   'push',  array['胸'],        array['哑铃']),
  ('绳索交叉夹胸',   'push',  array['胸'],        array['绳索']),
  ('窄距俯卧撑',     'push',  array['胸','三头'], array['自重']),
  ('硬拉',           'hinge', array['背','臀','腘绳肌'], array['杠铃']),
  ('坐姿器械划船',   'pull',  array['背'],        array['器械']),
  ('高位下拉',       'pull',  array['背'],        array['器械']),
  ('罗马椅挺身',     'hinge', array['下背','竖脊肌'], array['器械']),
  ('面拉',           'pull',  array['肩后束'],    array['绳索']),
  ('杠铃深蹲',       'squat', array['股四头肌','臀'], array['杠铃']),
  ('哑铃提踵',       'calf',  array['小腿'],      array['哑铃']),
  ('器械髋内收',     'adduction', array['大腿内侧'], array['器械']),
  ('器械髋外展',     'abduction', array['臀','大腿外侧'], array['器械']),
  ('哑铃肩推',       'push',  array['三角肌'],    array['哑铃']),
  ('侧平举',         'raise', array['三角肌中束'], array['哑铃']),
  ('前平举',         'raise', array['三角肌前束'], array['哑铃']),
  ('俯身反向平举',   'raise', array['三角肌后束'], array['哑铃']),
  ('卷腹',           'core',  array['腹'],        array['自重']),
  ('悬垂举腿',       'core',  array['腹'],        array['单杠']),
  ('反向卷腹',       'core',  array['腹'],        array['自重'])
on conflict (canonical_name_zh) do nothing;

do $seed$
declare
  target_method_id uuid;
  target_release_id uuid;
begin
  if exists (select 1 from public.methods where key = 'four_split_2026' and version = '1.0') then
    raise exception 'four_split_2026 is already seeded';
  end if;

  insert into public.methods (key, name, version, status, description, source_type, source_metadata)
  values (
    'four_split_2026', '四分化', '1.0', 'active',
    '胸 → 背 → 腿 → 肩 四个训练日，另有可选的腹肌日。有氧和休息日自行穿插（建议每 2–3 个训练日休息一天）。',
    'imported',
    jsonb_build_object(
      'origin', 'user_supplied_articles',
      'author', '铁棍顶着门（小黑盒）',
      'note', '腹肌日来自通用公开攻略，不是原文的一部分'
    )
  )
  returning id into target_method_id;

  insert into public.method_releases (
    method_id, version, status, release_channel, release_policy,
    runtime_gate_status, strict_gate_status, validation_report_json, release_notes, validated_at
  ) values (
    target_method_id, '1.0', 'validated', 'internal_beta', 'v1_runtime',
    'passed', 'pending',
    jsonb_build_object('valid', true, 'runtime_gate', 'passed', 'source', 'user_supplied_articles'),
    '四分化 1.0：胸/背/腿/肩 + 可选腹肌日。组数范围取下限，来源与默认值在每条规则的 source_authority 中标注。',
    now()
  )
  returning id into target_release_id;

  insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index, primary_focus, description, day_type, is_required)
  values
    (target_method_id, target_release_id, 'chest',     '胸', 1, array['胸','三头'],     'Day 1：胸 + 三头', 'strength', true),
    (target_method_id, target_release_id, 'back',      '背', 2, array['背','下背','肩后束'], 'Day 2：背', 'strength', true),
    (target_method_id, target_release_id, 'legs',      '腿', 3, array['股四头肌','臀','腘绳肌','小腿'], 'Day 3：腿', 'strength', true),
    (target_method_id, target_release_id, 'shoulders', '肩', 4, array['三角肌'],       'Day 4：肩', 'strength', true),
    (target_method_id, target_release_id, 'core',      '腹肌', 5, array['腹'],         '可选：腹肌日，不计入一轮完成', 'core', false);

  create temporary table seed_catalog on commit drop as
  select * from (values
    -- split, ord, exercise, role, rule_key, sets, reps_min, reps_max, rest_min, rest_max, failure_allowed, authority, summary, quality
    ('chest', 1,'杠铃卧推',     'primary',   'FS-CHEST-01',5,5,8,   null,null,false,'method_explicit',          '5 组 × 5–8 次（重量逐步加到 80%–90% 1RM）', null),
    ('chest', 2,'上斜哑铃卧推', 'secondary', 'FS-CHEST-02',4,8,10,  null,null,false,'method_explicit',          '4 组 × 8–10 次（中重量控制）', null),
    ('chest', 3,'下斜器械卧推', 'secondary', 'FS-CHEST-03',4,10,12, null,null,false,'method_explicit',          '4 组 × 10–12 次（刺激下束）', null),
    ('chest', 4,'哑铃平板卧推', 'secondary', 'FS-CHEST-04',3,10,10, null,null,false,'method_explicit',          '3 组 × 10 次（宽距握法）', null),
    ('chest', 5,'绳索交叉夹胸', 'isolation', 'FS-CHEST-05',3,15,15, null,null,false,'method_explicit',          '3 组 × 15 次', null),
    ('chest', 6,'窄距俯卧撑',   'accessory', 'FS-CHEST-06',3,8,15,  null,null,true, 'product_execution_default','3 组，每组力竭（原文未给次数，8–15 次仅为参考）', '力竭为止；次数仅为参考'),
    ('back',  1,'硬拉',         'primary',   'FS-BACK-01', 4,6,8,   null,null,false,'method_explicit',          '4 组 × 6–8 次', null),
    ('back',  2,'坐姿器械划船', 'secondary', 'FS-BACK-02', 4,8,10,  null,null,false,'method_explicit',          '4 组 × 8–10 次', null),
    ('back',  3,'高位下拉',     'secondary', 'FS-BACK-03', 4,8,12,  null,null,false,'method_explicit',          '4 组 × 8–12 次（大臂内收，主攻大圆肌）', null),
    ('back',  4,'罗马椅挺身',   'accessory', 'FS-BACK-04', 4,10,12, null,null,false,'method_explicit',          '4 组 × 10–12 次', null),
    ('back',  5,'面拉',         'isolation', 'FS-BACK-05', 4,12,16, null,null,false,'method_explicit',          '4 组 × 12–16 次（四分化推荐加入，强化肩后束）', null),
    ('legs',  1,'杠铃深蹲',     'primary',   'FS-LEGS-01', 5,5,5,   120,180,false,'method_explicit',            '5 组 × 5 次；组间休息 2–3 分钟', null),
    ('legs',  2,'罗马尼亚硬拉', 'secondary', 'FS-LEGS-02', 3,8,10,  120,180,false,'product_execution_default','3 组 × 8–10 次（原文 3–4 组，取下限）', null),
    ('legs',  3,'保加利亚分腿蹲','secondary','FS-LEGS-03', 3,8,10,  null,null,false,'product_execution_default','每侧 3 组 × 8–10 次（原文 3–4 组，取下限）', '每侧'),
    ('legs',  4,'哑铃提踵',     'isolation', 'FS-LEGS-04', 4,12,16, 60,120,false, 'product_execution_default','4 组 × 12–16 次（原文 4–6 组，取下限）；组间休息 1–2 分钟', null),
    ('legs',  5,'器械髋内收',   'accessory', 'FS-LEGS-05', 3,12,16, null,null,false,'product_execution_default','3 组 × 12–16 次（原文 3–4 组，取下限）', null),
    ('legs',  6,'器械髋外展',   'accessory', 'FS-LEGS-06', 3,12,16, null,null,false,'product_execution_default','3 组 × 12–16 次（原文 3–4 组，取下限）', null),
    ('shoulders',1,'哑铃肩推',  'primary',   'FS-SHLD-01', 3,8,10,  60,60,false,   'method_explicit',           '3 组 × 8–10 次；组间休息 60 秒', null),
    ('shoulders',2,'侧平举',    'isolation', 'FS-SHLD-02', 3,10,12, 45,45,false,   'method_explicit',           '3 组 × 10–12 次；组间休息 45 秒', null),
    ('shoulders',3,'前平举',    'isolation', 'FS-SHLD-03', 3,10,12, 45,45,false,   'method_explicit',           '3 组 × 10–12 次；组间休息 45 秒', null),
    ('shoulders',4,'俯身反向平举','isolation','FS-SHLD-04',3,10,12, 45,45,false,   'product_execution_default','3 组 × 10–12 次（原文 2–3 组，取上限）；组间休息 45 秒', null),
    ('core',  1,'卷腹',         'isolation', 'FS-CORE-01', 3,15,20, null,null,false,'product_execution_default','3 组 × 15–20 次（通用攻略）', null),
    ('core',  2,'悬垂举腿',     'isolation', 'FS-CORE-02', 3,10,12, null,null,false,'product_execution_default','3 组 × 10–12 次（通用攻略）', null),
    ('core',  3,'反向卷腹',     'isolation', 'FS-CORE-03', 3,12,15, null,null,false,'product_execution_default','3 组 × 12–15 次（通用攻略）', null)
  ) as t(split_key, ord, name, role, rule_key, sets, reps_min, reps_max, rest_min, rest_max, failure_allowed, authority, summary, quality);

  if (select count(*) from seed_catalog c join public.exercises e on e.canonical_name_zh = c.name) <> (select count(*) from seed_catalog) then
    raise exception 'four-split seed: an exercise name did not resolve';
  end if;

  insert into public.method_rules (
    method_id, method_release_id, rule_key, rule_type, version, config_json, explanation_zh,
    status, source_authority, runtime_status, confidence, source_note, canonical_status,
    evidence_required, config_schema_version
  )
  select target_method_id, target_release_id, c.rule_key, 'prescription', '1.0',
    jsonb_build_object('schema', 'canonical-prescription-summary-v1', 'summary_zh', c.summary),
    c.summary, 'active', c.authority,
    case when c.authority = 'product_execution_default' then 'fallback_active' else 'active' end,
    'medium',
    case when c.authority = 'product_execution_default'
      then '组数/次数中有产品默认值，不要表述为作者原话。'
      else '来自用户提供的原文。' end,
    'active', false, 1
  from seed_catalog c;

  insert into public.method_split_exercises (
    method_split_id, exercise_id, order_index, method_role, prescription_rule_key,
    progression_rule_key, method_notes, field_provenance
  )
  select s.id, e.id, c.ord, c.role, c.rule_key, null, c.summary,
    jsonb_build_object('prescription', jsonb_build_object('authority', c.authority))
  from seed_catalog c
  join public.method_splits s on s.method_release_id = target_release_id and s.key = c.split_key
  join public.exercises e on e.canonical_name_zh = c.name;

  insert into public.method_runtime_set_templates (
    method_release_id, method_rule_id, set_index, set_type, target_reps_min, target_reps_max,
    failure_allowed, failure_required, rest_min_seconds, rest_max_seconds, quality_requirement,
    source_authority, evidence_key
  )
  select target_release_id, r.id, g.i, 'working', c.reps_min, c.reps_max,
    c.failure_allowed, false, c.rest_min, c.rest_max, c.quality, c.authority, null
  from seed_catalog c
  join public.method_rules r on r.method_release_id = target_release_id and r.rule_key = c.rule_key
  cross join lateral generate_series(1, c.sets) as g(i);

  update public.method_releases
  set status = 'active',
      release_notes = release_notes
  where id = target_release_id;
end;
$seed$;

commit;
