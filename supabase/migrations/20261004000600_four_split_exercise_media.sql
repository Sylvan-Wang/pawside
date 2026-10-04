-- Four-split method · exercise media from @bryllim/workout-guide 1.0.0 (CC BY-SA 4.0).
-- Presentation data only. Each mapping was checked by eye against the package frames.
-- 'confirmed' = same movement and equipment; 'candidate' = closest match, shown with
-- the existing mapping_notes semantics (never presented as an exact demonstration).
--
-- The unique (provider, external_slug, source_version) constraint is relaxed: two
-- Pawside exercises may legitimately share one illustration (山羊挺身 and 罗马椅挺身 are
-- both a back extension). The per-exercise uniqueness is kept.

begin;

do $drop$
declare
  slug_unique text;
begin
  select con.conname into slug_unique
  from pg_constraint con
  where con.conrelid = 'public.exercise_external_mappings'::regclass
    and con.contype = 'u'
    and (select array_agg(att.attname::text order by att.attname::text)
         from unnest(con.conkey) k join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k)
        = array['external_slug', 'provider', 'source_version'];
  if slug_unique is not null then
    execute format('alter table public.exercise_external_mappings drop constraint %I', slug_unique);
  end if;
end;
$drop$;

with media_seed(canonical_name_zh, external_slug, mapping_status, mapping_notes) as (
  values
    ('下斜器械卧推',   'decline-bench-press',        'candidate', '素材为杠铃下斜卧推；动作角度一致，器械不同。'),
    ('哑铃平板卧推',   'dumbbell-bench-press',       'confirmed', 'Exact dumbbell bench press match.'),
    ('绳索交叉夹胸',   'cable-fly',                  'candidate', '素材为单侧绳索夹胸；双侧交叉的路径一致。'),
    ('窄距俯卧撑',     'diamond-push-up',            'candidate', '钻石俯卧撑是窄距俯卧撑的更窄版本。'),
    ('硬拉',           'deadlift',                   'confirmed', 'Exact deadlift match.'),
    ('坐姿器械划船',   'machine-row',                'confirmed', 'Exact seated machine row match.'),
    ('高位下拉',       'lat-pulldown',               'confirmed', 'Exact lat pulldown match.'),
    ('罗马椅挺身',     'back-extension',             'confirmed', 'Exact Roman chair back extension match.'),
    ('面拉',           'face-pull',                  'confirmed', 'Exact face pull match.'),
    ('杠铃深蹲',       'squat',                      'confirmed', 'Exact barbell back squat match.'),
    ('哑铃提踵',       'calf-raise',                 'candidate', '素材为自重提踵；动作一致，没有持哑铃。'),
    ('器械髋内收',     'hip-adduction-machine',      'confirmed', 'Exact hip adduction machine match.'),
    ('器械髋外展',     'hip-abduction-machine',      'confirmed', 'Exact hip abduction machine match.'),
    ('哑铃肩推',       'seated-dumbbell-press',      'confirmed', 'Seated dumbbell shoulder press (the method allows seated or standing).'),
    ('侧平举',         'lateral-raise',              'confirmed', 'Exact dumbbell lateral raise match.'),
    ('前平举',         'front-raise',                'confirmed', 'Exact dumbbell front raise match.'),
    ('俯身反向平举',   'bent-over-rear-delt-raise',  'confirmed', 'Exact bent-over rear delt raise match.'),
    ('卷腹',           'crunch',                     'candidate', '素材为双腿搁凳的卷腹；动作一致。'),
    ('悬垂举腿',       'hanging-leg-raise',          'confirmed', 'Exact hanging leg raise match.'),
    ('反向卷腹',       'reverse-crunch',             'confirmed', 'Exact reverse crunch match.')
)
insert into public.exercise_external_mappings (
  exercise_id, provider, external_slug, source_version, license, attribution,
  source_url, mapping_status, mapping_notes, reviewed_at
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
on conflict (exercise_id, provider, source_version) do nothing;

commit;
