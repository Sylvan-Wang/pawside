-- 居家轻力量 (home five-session) — two versions, seeded as VALIDATED, NOT ACTIVE.
--
--   home_bodyweight_five_2026   徒手版   needs: home_bodyweight
--   home_dumbbell_five_2026     小器械版 needs: basic_equipment (dumbbells)
--
-- Product-wise this is one method with two versions; in data each version is its own
-- method so the existing switching / enrollment / history code is reused as is, and
-- switching version keeps all training history. Source: docs/product/system/method/
-- home-five-session/PATCH_v0.6_simplified.md (Pawside original composition, not a
-- re-creation of any creator's programme; every prescription is product_execution_default).
--
-- Five training days (a recommended rotation, not a weekly quota):
--   glute_leg_base 臀腿基础 → upper_base 上肢基础 → comfort_cardio 舒适有氧 →
--   glute_leg_extra 臀腿补充 → upper_core 上肢与核心
-- Where the patch gives a range of sets ("1–2 组") the lower bound is used, as in the
-- four-split seed. Warm-up and cool-down are described in the method text, not as exercises.
-- Per-side work is written in the prescription text ("每侧"); one set records one count.
--
-- The releases stay 'validated' so they do not appear in the method list. To open them
-- to users, set status = 'active' on each release (an active release is immutable).
-- Not run against a database in this change: online execution and activation need
-- Sylvan's go-ahead.

begin;

insert into public.exercises (canonical_name_zh, movement_pattern, target_regions, equipment, record_shape)
values
  ('徒手深蹲',           'squat',   array['股四头肌','臀'],       array['自重'],   'bodyweight_reps'),
  ('杯式深蹲',           'squat',   array['股四头肌','臀'],       array['哑铃'],   'weight_reps'),
  ('臀桥',               'hinge',   array['臀','腘绳肌'],         array['自重'],   'bodyweight_reps'),
  ('徒手提踵',           'calf',    array['小腿'],                array['自重'],   'bodyweight_reps'),
  ('跪姿俯卧撑',         'push',    array['胸','三头'],           array['自重'],   'bodyweight_reps'),
  ('俯卧W抬臂',          'pull',    array['上背','肩后束'],       array['自重'],   'bodyweight_reps'),
  ('俯卧反向雪天使',     'pull',    array['上背','肩后束'],       array['自重'],   'bodyweight_reps'),
  ('墙面俯卧撑',         'push',    array['胸','三头'],           array['自重'],   'bodyweight_reps'),
  ('支撑单臂哑铃划船',   'pull',    array['背'],                  array['哑铃'],   'weight_reps'),
  ('徒手分腿蹲',         'squat',   array['股四头肌','臀'],       array['自重'],   'bodyweight_reps'),
  ('哑铃分腿蹲',         'squat',   array['股四头肌','臀'],       array['哑铃'],   'weight_reps'),
  ('哑铃罗马尼亚硬拉',   'hinge',   array['臀','腘绳肌'],         array['哑铃'],   'weight_reps'),
  ('侧卧抬腿',           'abduction', array['臀','大腿外侧'],     array['自重'],   'bodyweight_reps'),
  ('死虫式',             'core',    array['腹','核心'],           array['自重'],   'bodyweight_reps'),
  ('鸟狗式',             'core',    array['核心','下背'],         array['自重'],   'bodyweight_reps'),
  ('轻松踏步有氧',       'cardio',  array['心肺'],                array['自重'],   'duration')
on conflict (canonical_name_zh) do nothing;

do $seed$
declare
  m record;
  target_method_id uuid;
  target_release_id uuid;
begin
  if not exists (select 1 from public.exercises where canonical_name_zh = '侧平举') then
    raise exception 'home-five-session seed needs 侧平举 (created by the four-split seed)';
  end if;

  create temporary table home_methods on commit drop as
  select * from (values
    ('home_bodyweight_five_2026', '居家轻力量·徒手版', 'home_bodyweight',
     '不需要任何器械的居家训练：臀腿、上肢、有氧、核心，五个训练日轮着练。五天是推荐的顺序，不是每周必须练满五次，漏练不欠账。每次含 3–5 分钟热身和 2–4 分钟放松。'),
    ('home_dumbbell_five_2026', '居家轻力量·小器械版', 'basic_equipment',
     '一对哑铃就能练：臀腿、上肢、有氧、核心，五个训练日轮着练。五天是推荐的顺序，不是每周必须练满五次，漏练不欠账。每次含 3–5 分钟热身和 2–4 分钟放松。')
  ) as t(method_key, name, required_equipment, description);

  create temporary table home_splits on commit drop as
  select * from (values
    ('glute_leg_base',  '臀腿基础',   1, array['股四头肌','臀','小腿'],     'Day 1：臀腿基础', 'strength'),
    ('upper_base',      '上肢基础',   2, array['背','胸','肩后束'],         'Day 2：上肢基础', 'strength'),
    ('comfort_cardio',  '舒适有氧',   3, array['心肺'],                    'Day 3：舒适有氧，强度以能说完整句子为准', 'cardio'),
    ('glute_leg_extra', '臀腿补充',   4, array['臀','腘绳肌','股四头肌'],   'Day 4：臀腿补充', 'strength'),
    ('upper_core',      '上肢与核心', 5, array['背','胸','核心'],           'Day 5：上肢与核心', 'strength')
  ) as t(split_key, name_zh, order_index, primary_focus, description, day_type);

  -- method_key, split, ord, exercise, role, rule_key, sets, reps_min, reps_max, seconds, summary, quality
  create temporary table home_catalog on commit drop as
  select * from (values
    -- 徒手版
    ('home_bodyweight_five_2026','glute_leg_base', 1,'徒手深蹲',       'primary',  'HB-A-01',2, 8,12,null,'2 组 × 8–12 次', '脚掌踩稳，幅度以动作稳定为准'),
    ('home_bodyweight_five_2026','glute_leg_base', 2,'臀桥',           'secondary','HB-A-02',2,10,15,null,'2 组 × 10–15 次','顶端停一下，不用腰代偿'),
    ('home_bodyweight_five_2026','glute_leg_base', 3,'徒手提踵',       'accessory','HB-A-03',2,10,15,null,'2 组 × 10–15 次','缓慢控制'),
    ('home_bodyweight_five_2026','upper_base',     1,'跪姿俯卧撑',     'primary',  'HB-B-01',2, 6,10,null,'2 组 × 6–10 次', '躯干保持一条线，肘不过度外展'),
    ('home_bodyweight_five_2026','upper_base',     2,'俯卧W抬臂',      'secondary','HB-B-02',2, 8,12,null,'2 组 × 8–12 次', '小幅、舒适范围，不强行仰头抬腰'),
    ('home_bodyweight_five_2026','upper_base',     3,'俯卧反向雪天使', 'accessory','HB-B-03',1, 6,10,null,'1 组 × 6–10 次', '小幅、舒适范围，不强行仰头抬腰'),
    ('home_bodyweight_five_2026','comfort_cardio', 1,'轻松踏步有氧',   'primary',  'HB-C-01',1,null,null,900,'15 分钟：轻松踏步 3 分钟 → 舒适节奏踏步/侧向并步 9 分钟 → 轻松踏步 3 分钟','无跳跃；舒适快走的强度，能说完整句子'),
    ('home_bodyweight_five_2026','glute_leg_extra',1,'徒手分腿蹲',     'primary',  'HB-D-01',1, 6,10,null,'每侧 1 组 × 6–10 次','不稳可换徒手深蹲，允许更小幅度'),
    ('home_bodyweight_five_2026','glute_leg_extra',2,'臀桥',           'secondary','HB-D-02',2,10,15,null,'2 组 × 10–15 次','顶端停一下，不用腰代偿'),
    ('home_bodyweight_five_2026','glute_leg_extra',3,'侧卧抬腿',       'accessory','HB-D-03',1, 8,12,null,'每侧 1 组 × 8–12 次','髋保持稳定，不转动身体'),
    ('home_bodyweight_five_2026','upper_core',     1,'跪姿俯卧撑',     'primary',  'HB-E-01',1, 6,10,null,'1 组 × 6–10 次', '躯干保持一条线，肘不过度外展'),
    ('home_bodyweight_five_2026','upper_core',     2,'俯卧W抬臂',      'secondary','HB-E-02',1, 8,12,null,'1 组 × 8–12 次', '小幅、舒适范围'),
    ('home_bodyweight_five_2026','upper_core',     3,'死虫式',         'accessory','HB-E-03',2, 6, 8,null,'每侧 2 组 × 6–8 次','缓慢控制，不憋气'),
    ('home_bodyweight_five_2026','upper_core',     4,'鸟狗式',         'accessory','HB-E-04',2, 6, 8,null,'每侧 2 组 × 6–8 次','缓慢控制，不憋气'),
    -- 小器械版
    ('home_dumbbell_five_2026','glute_leg_base',   1,'杯式深蹲',       'primary',  'HD-A-01',2, 8,12,null,'2 组 × 8–12 次', '选能稳定完成、结束时还能再做 2–3 次的重量；脚掌踩稳'),
    ('home_dumbbell_five_2026','glute_leg_base',   2,'臀桥',           'secondary','HD-A-02',2,10,15,null,'2 组 × 10–15 次','顶端停一下，不用腰代偿'),
    ('home_dumbbell_five_2026','glute_leg_base',   3,'徒手提踵',       'accessory','HD-A-03',2,10,15,null,'2 组 × 10–15 次','缓慢控制'),
    ('home_dumbbell_five_2026','upper_base',       1,'支撑单臂哑铃划船','primary', 'HD-B-01',2, 8,12,null,'每侧 2 组 × 8–12 次','支撑稳定，不扭转躯干'),
    ('home_dumbbell_five_2026','upper_base',       2,'墙面俯卧撑',     'secondary','HD-B-02',2, 8,12,null,'2 组 × 8–12 次', '身体整体可控'),
    ('home_dumbbell_five_2026','upper_base',       3,'侧平举',         'isolation','HD-B-03',1, 8,12,null,'可选：轻哑铃 1 组 × 8–12 次','选轻重量，肩不耸起'),
    ('home_dumbbell_five_2026','comfort_cardio',   1,'轻松踏步有氧',   'primary',  'HD-C-01',1,null,null,900,'15 分钟：轻松踏步 3 分钟 → 舒适节奏踏步/侧向并步 9 分钟 → 轻松踏步 3 分钟','无跳跃；舒适快走的强度，能说完整句子'),
    ('home_dumbbell_five_2026','glute_leg_extra',  1,'哑铃罗马尼亚硬拉','primary', 'HD-D-01',2, 8,12,null,'2 组 × 8–12 次','膝微屈、髋向后，不追求触地；不熟悉时先做无负重髋铰链'),
    ('home_dumbbell_five_2026','glute_leg_extra',  2,'哑铃分腿蹲',     'secondary','HD-D-02',1, 6,10,null,'每侧 1 组 × 6–10 次','可扶墙或稳固物保持平衡；不稳可换杯式深蹲'),
    ('home_dumbbell_five_2026','glute_leg_extra',  3,'侧卧抬腿',       'accessory','HD-D-03',1, 8,12,null,'每侧 1 组 × 8–12 次','髋保持稳定，不转动身体'),
    ('home_dumbbell_five_2026','upper_core',       1,'支撑单臂哑铃划船','primary', 'HD-E-01',1, 8,12,null,'每侧 1 组 × 8–12 次','支撑稳定，不扭转躯干'),
    ('home_dumbbell_five_2026','upper_core',       2,'墙面俯卧撑',     'secondary','HD-E-02',1, 8,12,null,'1 组 × 8–12 次', '身体整体可控'),
    ('home_dumbbell_five_2026','upper_core',       3,'死虫式',         'accessory','HD-E-03',2, 6, 8,null,'每侧 2 组 × 6–8 次','缓慢控制，不憋气'),
    ('home_dumbbell_five_2026','upper_core',       4,'鸟狗式',         'accessory','HD-E-04',2, 6, 8,null,'每侧 2 组 × 6–8 次','缓慢控制，不憋气')
  ) as t(method_key, split_key, ord, name, role, rule_key, sets, reps_min, reps_max, seconds, summary, quality);

  if (select count(*) from home_catalog c join public.exercises e on e.canonical_name_zh = c.name) <> (select count(*) from home_catalog) then
    raise exception 'home-five-session seed: an exercise name did not resolve';
  end if;

  for m in select * from home_methods loop
    if exists (select 1 from public.methods where key = m.method_key and version = '1.0') then
      raise exception '% is already seeded', m.method_key;
    end if;

    insert into public.methods (key, name, version, status, description, source_type, source_metadata, required_equipment)
    values (
      m.method_key, m.name, '1.0', 'active', m.description, 'imported',
      jsonb_build_object(
        'origin', 'pawside_original_composition',
        'note', '动作、组次和休息由 Pawside 编排，不是任何创作者的官方课表。参考视频未经逐动作核验，不作为动作处方来源。'
      ),
      m.required_equipment
    )
    returning id into target_method_id;

    insert into public.method_releases (
      method_id, version, status, release_channel, release_policy,
      runtime_gate_status, strict_gate_status, validation_report_json, release_notes, validated_at
    ) values (
      target_method_id, '1.0', 'validated', 'internal_beta', 'v1_runtime',
      'passed', 'pending',
      jsonb_build_object('valid', true, 'runtime_gate', 'passed', 'source', 'pawside_original_composition'),
      '居家轻力量 1.0（审阅稿）：五个训练日。组数范围取下限，所有处方均为产品默认值（product_execution_default）。尚未激活。',
      now()
    )
    returning id into target_release_id;

    insert into public.method_splits (method_id, method_release_id, key, name_zh, order_index, primary_focus, description, day_type, is_required)
    select target_method_id, target_release_id, s.split_key, s.name_zh, s.order_index, s.primary_focus, s.description, s.day_type, true
    from home_splits s;

    insert into public.method_rules (
      method_id, method_release_id, rule_key, rule_type, version, config_json, explanation_zh,
      status, source_authority, runtime_status, confidence, source_note, canonical_status,
      evidence_required, config_schema_version
    )
    select target_method_id, target_release_id, c.rule_key, 'prescription', '1.0',
      jsonb_build_object('schema', 'canonical-prescription-summary-v1', 'summary_zh', c.summary),
      c.summary, 'active', 'product_execution_default', 'fallback_active', 'medium',
      'Pawside 原创编排的产品默认值，不要表述为创作者原话。', 'active', false, 1
    from home_catalog c
    where c.method_key = m.method_key;

    insert into public.method_split_exercises (
      method_split_id, exercise_id, order_index, method_role, prescription_rule_key,
      progression_rule_key, method_notes, field_provenance
    )
    select s.id, e.id, c.ord, c.role, c.rule_key, null, c.summary,
      jsonb_build_object('prescription', jsonb_build_object('authority', 'product_execution_default'))
    from home_catalog c
    join public.method_splits s on s.method_release_id = target_release_id and s.key = c.split_key
    join public.exercises e on e.canonical_name_zh = c.name
    where c.method_key = m.method_key;

    insert into public.method_runtime_set_templates (
      method_release_id, method_rule_id, set_index, set_type, target_reps_min, target_reps_max,
      failure_allowed, failure_required, rest_min_seconds, rest_max_seconds, quality_requirement,
      source_authority, evidence_key, target_duration_seconds, target_distance_m
    )
    select target_release_id, r.id, g.i, 'working', c.reps_min, c.reps_max,
      false, false,
      case when c.seconds is null then 60 end,
      case when c.seconds is null then 90 end,
      c.quality, 'product_execution_default', null, c.seconds, null
    from home_catalog c
    join public.method_rules r on r.method_release_id = target_release_id and r.rule_key = c.rule_key
    cross join lateral generate_series(1, c.sets) as g(i)
    where c.method_key = m.method_key;
  end loop;
end;
$seed$;

commit;
