-- Method import foundation F3: duration and distance prescription targets.
begin;
alter table public.set_prescriptions
  add column target_duration_seconds integer
    check (target_duration_seconds is null or target_duration_seconds > 0),
  add column target_distance_m numeric(9,2)
    check (target_distance_m is null or target_distance_m > 0);
alter table public.method_runtime_set_templates
  add column target_duration_seconds integer
    check (target_duration_seconds is null or target_duration_seconds > 0),
  add column target_distance_m numeric(9,2)
    check (target_distance_m is null or target_distance_m > 0);
commit;
