-- Method import foundation F3: day types, optional days, gaps, and skipped prescriptions.
begin;
alter table public.method_splits
  add column day_type text not null default 'strength'
    check (day_type in ('strength', 'core', 'cardio')),
  add column is_required boolean not null default true,
  add column min_gap_days smallint not null default 0
    check (min_gap_days between 0 and 7);

alter table public.session_prescriptions add constraint session_prescriptions_status_v2_check
  check (status in ('upcoming', 'ready', 'started', 'completed', 'rest_deferred', 'cancelled', 'skipped')) not valid;
alter table public.session_prescriptions validate constraint session_prescriptions_status_v2_check;
alter table public.session_prescriptions drop constraint session_prescriptions_status_check;
commit;
