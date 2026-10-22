-- Optional tutorial link per exercise (one https Bilibili URL).
-- The app shows it only when tutorial_verified_at is set, i.e. someone has confirmed
-- the publisher account and that the page opens. A name match alone does not count.
-- GIF / pose-frame media stays in exercise_external_mappings; this is a separate source.
--
-- Additive. Online execution requires Sylvan's go-ahead.

begin;

alter table public.exercises
  add column tutorial_url text
    check (tutorial_url is null or tutorial_url ~ '^https://(www\.|m\.)?bilibili\.com/video/[A-Za-z0-9]+'),
  add column tutorial_verified_at timestamptz;

alter table public.exercises add constraint exercises_tutorial_verified_needs_url_check
  check (tutorial_verified_at is null or tutorial_url is not null);

comment on column public.exercises.tutorial_url is
  'Optional full-video tutorial (Bilibili). Shown as a small text link at the bottom of the exercise card, only when tutorial_verified_at is set.';
comment on column public.exercises.tutorial_verified_at is
  'Set when the publisher account and the page were checked. Null = hidden from users.';

commit;
