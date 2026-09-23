-- Extend the pinned workout-guide 1.0.0 catalog for the Canonical Method v1.2.
-- Media is optional presentation data. Missing exact matches stay unmapped.

begin;

insert into public.exercises (canonical_name_zh)
values
  ('单手绳索下拉'),
  ('对握高位下拉'),
  ('单手器械划船'),
  ('坐姿开肘划船'),
  ('坐姿肩屈位绳索弯举'),
  ('单腿硬拉'),
  ('保加利亚分腿蹲'),
  ('前蹲/颈前深蹲'),
  ('罗马尼亚硬拉'),
  ('山羊挺身')
on conflict (canonical_name_zh) do nothing;

with media_seed(
  canonical_name_zh,
  external_slug,
  mapping_status,
  mapping_notes
) as (
  values
    ('对握高位下拉', 'close-grip-lat-pulldown', 'candidate', 'Closest neutral/close-grip pulldown; confirm handle and path against Method media.'),
    ('坐姿开肘划船', 'seated-row', 'candidate', 'Generic seated cable row; confirm the elbows-out path before marking exact.'),
    ('坐姿肩屈位绳索弯举', 'cable-curl', 'candidate', 'Generic cable curl; confirm the seated shoulder-flexed setup before marking exact.'),
    ('单腿硬拉', 'single-leg-romanian-deadlift', 'candidate', 'Closest single-leg hinge; confirm the exact Method execution.'),
    ('保加利亚分腿蹲', 'bulgarian-split-squat', 'confirmed', 'Exact Bulgarian split squat match.'),
    ('前蹲/颈前深蹲', 'front-squat', 'confirmed', 'Exact front squat match.'),
    ('罗马尼亚硬拉', 'romanian-deadlift', 'confirmed', 'Exact Romanian deadlift match.'),
    ('山羊挺身', 'back-extension', 'confirmed', 'Exact back extension match.')
)
insert into public.exercise_external_mappings (
  exercise_id,
  provider,
  external_slug,
  source_version,
  license,
  attribution,
  source_url,
  mapping_status,
  mapping_notes,
  reviewed_at
)
select
  e.id,
  '@bryllim/workout-guide',
  seed.external_slug,
  '1.0.0',
  'CC BY-SA 4.0',
  'Original exercise artwork by Everkinetic, expanded by Bryl Lim, licensed under CC BY-SA 4.0.',
  'https://bryllim.github.io/workout-guide/exercises/' || seed.external_slug || '/',
  seed.mapping_status,
  seed.mapping_notes,
  case when seed.mapping_status = 'confirmed' then now() else null end
from media_seed seed
join public.exercises e on e.canonical_name_zh = seed.canonical_name_zh
on conflict (exercise_id, provider, source_version) do update set
  external_slug = excluded.external_slug,
  license = excluded.license,
  attribution = excluded.attribution,
  source_url = excluded.source_url,
  mapping_status = excluded.mapping_status,
  mapping_notes = excluded.mapping_notes,
  reviewed_at = excluded.reviewed_at;

comment on table public.exercise_external_mappings is
  'Presentation-only provider mappings. Candidate or missing media never establishes Method truth.';

commit;
