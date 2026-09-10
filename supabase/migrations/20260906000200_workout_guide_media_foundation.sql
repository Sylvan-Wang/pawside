-- Pawside exercise media foundation for @bryllim/workout-guide 1.0.0.
--
-- Package code is MIT licensed. Visual frames are CC BY-SA 4.0 and require
-- attribution. External slugs remain provider identifiers; Pawside exercise
-- UUIDs remain the business foreign keys.

alter table public.exercise_external_mappings
  add column mapping_status text not null default 'candidate',
  add column mapping_notes text,
  add column reviewed_at timestamptz;

alter table public.exercise_external_mappings
  add constraint exercise_external_mappings_status_check
  check (mapping_status in ('candidate', 'confirmed', 'rejected'));

comment on column public.exercise_external_mappings.mapping_status is
  'confirmed means exact movement identity; candidate must be labelled for human review.';

with media_seed(
  canonical_name_zh,
  external_slug,
  mapping_status,
  mapping_notes
) as (
  values
    ('杠铃卧推', 'bench-press', 'confirmed', 'Exact barbell bench press match.'),
    ('上斜哑铃卧推', 'incline-dumbbell-press', 'confirmed', 'Exact incline dumbbell press match.'),
    ('双杠臂屈伸', 'chest-dip', 'candidate', 'Closest chest-focused parallel-bar dip. Confirm torso angle and Method intent before marking exact.'),
    ('仰卧杠铃臂屈伸', 'skull-crusher', 'confirmed', 'Exact lying barbell triceps extension / skull crusher match.'),
    ('Y 字侧平举', 'prone-y-raise', 'candidate', 'Only Y-raise entry in provider catalog. Confirm prone versus standing/cable execution before marking exact.')
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
