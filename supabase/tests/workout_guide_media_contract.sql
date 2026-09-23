-- Run after 20260909000500_workout_guide_method_catalog.sql.

do $test$
declare
  exercise_count integer;
  mapped_count integer;
  candidate_count integer;
  confirmed_count integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'exercise_external_mappings'
      and column_name = 'mapping_status'
  ) then
    raise exception 'exercise_external_mappings.mapping_status is missing';
  end if;

  select count(*)
  into exercise_count
  from public.exercises
  where canonical_name_zh in (
    '杠铃卧推', '上斜哑铃卧推', '双杠臂屈伸', '仰卧杠铃臂屈伸', 'Y 字侧平举',
    '单手绳索下拉', '对握高位下拉', '单手器械划船', '坐姿开肘划船',
    '坐姿肩屈位绳索弯举', '单腿硬拉', '保加利亚分腿蹲',
    '前蹲/颈前深蹲', '罗马尼亚硬拉', '山羊挺身'
  );

  if exercise_count <> 15 then
    raise exception 'Expected 15 Canonical Method exercise identities, found %', exercise_count;
  end if;

  select count(*),
         count(*) filter (where m.mapping_status = 'candidate'),
         count(*) filter (where m.mapping_status = 'confirmed')
  into mapped_count, candidate_count, confirmed_count
  from public.exercise_external_mappings m
  join public.exercises e on e.id = m.exercise_id
  where m.provider = '@bryllim/workout-guide'
    and m.source_version = '1.0.0'
    and e.canonical_name_zh in (
      '杠铃卧推', '上斜哑铃卧推', '双杠臂屈伸', '仰卧杠铃臂屈伸', 'Y 字侧平举',
      '单手绳索下拉', '对握高位下拉', '单手器械划船', '坐姿开肘划船',
      '坐姿肩屈位绳索弯举', '单腿硬拉', '保加利亚分腿蹲',
      '前蹲/颈前深蹲', '罗马尼亚硬拉', '山羊挺身'
    );

  if mapped_count <> 13 or candidate_count <> 6 or confirmed_count <> 7 then
    raise exception
      'Expected 13 mappings (6 candidate, 7 confirmed), found % (% candidate, % confirmed)',
      mapped_count, candidate_count, confirmed_count;
  end if;

  if exists (
    select 1
    from public.exercise_external_mappings m
    join public.exercises e on e.id = m.exercise_id
    where m.provider = '@bryllim/workout-guide'
      and m.source_version = '1.0.0'
      and e.canonical_name_zh in ('单手绳索下拉', '单手器械划船')
  ) then
    raise exception 'Exercises without an exact-enough provider match must remain unmapped';
  end if;

  if exists (
    select 1
    from public.exercise_external_mappings
    where provider = '@bryllim/workout-guide'
      and source_version = '1.0.0'
      and (license <> 'CC BY-SA 4.0' or attribution = '')
  ) then
    raise exception 'Workout Guide mapping is missing required license attribution';
  end if;

  if exists (
    select 1
    from public.exercise_external_mappings
    where provider = '@bryllim/workout-guide'
      and mapping_status = 'confirmed'
      and reviewed_at is null
  ) then
    raise exception 'Confirmed Workout Guide mappings require a review timestamp';
  end if;
end;
$test$;

select
  e.canonical_name_zh,
  m.external_slug,
  m.mapping_status,
  m.license,
  m.source_url
from public.exercise_external_mappings m
join public.exercises e on e.id = m.exercise_id
where m.provider = '@bryllim/workout-guide'
  and m.source_version = '1.0.0'
order by e.canonical_name_zh;
