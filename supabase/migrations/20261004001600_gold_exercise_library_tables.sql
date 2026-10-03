-- Method import foundation F4: reviewed exercise defaults, substitutions, and cues.
begin;
alter table public.exercises
  add column risk_flags text[] not null default '{}';
comment on column public.exercises.risk_flags is
  '例如 beginner_risk、failure_risk、spine_load。仅用于导入时的提示，不用于拦截训练。';

create table public.exercise_defaults (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  sets_min smallint check (sets_min is null or sets_min between 1 and 12),
  sets_max smallint check (sets_max is null or sets_max between 1 and 12),
  reps_min smallint check (reps_min is null or reps_min between 1 and 100),
  reps_max smallint check (reps_max is null or reps_max between 1 and 100),
  rest_seconds_min integer check (rest_seconds_min is null or rest_seconds_min between 0 and 600),
  rest_seconds_max integer check (rest_seconds_max is null or rest_seconds_max between 0 and 600),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 7200),
  distance_m numeric(9,2) check (distance_m is null or distance_m > 0),
  failure_policy text not null default 'avoid' check (failure_policy in ('avoid', 'allowed', 'required')),
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed')),
  source_note text,
  created_at timestamptz not null default now(),
  unique (exercise_id, level),
  check (sets_min is null or sets_max is null or sets_min <= sets_max),
  check (reps_min is null or reps_max is null or reps_min <= reps_max),
  check (rest_seconds_min is null or rest_seconds_max is null or rest_seconds_min <= rest_seconds_max)
);

create table public.exercise_substitutions (
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  substitute_exercise_id uuid not null references public.exercises(id) on delete restrict,
  kind text not null check (kind in ('swap', 'regression', 'progression')),
  note text,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed')),
  primary key (exercise_id, substitute_exercise_id, kind),
  check (exercise_id <> substitute_exercise_id)
);

create table public.exercise_cues (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  kind text not null check (kind in ('setup', 'execution', 'breathing', 'common_mistake', 'safety')),
  text_zh text not null check (length(text_zh) between 1 and 200),
  sort_order smallint not null default 0,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed'))
);
create index exercise_cues_exercise_idx on public.exercise_cues(exercise_id, sort_order);

alter table public.exercise_defaults enable row level security;
alter table public.exercise_substitutions enable row level security;
alter table public.exercise_cues enable row level security;
revoke all on table public.exercise_defaults, public.exercise_substitutions, public.exercise_cues from anon, authenticated;
grant select on table public.exercise_defaults, public.exercise_substitutions, public.exercise_cues to authenticated;
create policy exercise_defaults_authenticated_read on public.exercise_defaults for select to authenticated using (true);
create policy exercise_substitutions_authenticated_read on public.exercise_substitutions for select to authenticated using (true);
create policy exercise_cues_authenticated_read on public.exercise_cues for select to authenticated using (true);
commit;
