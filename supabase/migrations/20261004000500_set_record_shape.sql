-- Method import foundation F2: duration and distance facts for completed sets.
begin;
alter table public.set_executions
  add column actual_duration_seconds integer
    check (actual_duration_seconds is null or actual_duration_seconds >= 0),
  add column actual_distance_m numeric(9,2)
    check (actual_distance_m is null or actual_distance_m >= 0);

alter table public.set_executions add constraint set_executions_completed_has_measure check (
  (status = 'completed' and completed_at is not null
     and (actual_reps is not null or actual_duration_seconds is not null or actual_distance_m is not null))
  or status <> 'completed'
) not valid;
alter table public.set_executions validate constraint set_executions_completed_has_measure;
alter table public.set_executions drop constraint set_executions_check;
commit;
