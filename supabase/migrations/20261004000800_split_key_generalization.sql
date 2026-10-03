-- Method import foundation F3: generalize split keys without changing existing rows.
begin;
alter table public.method_splits add constraint method_splits_key_format_check
  check (key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.method_splits validate constraint method_splits_key_format_check;
alter table public.method_splits drop constraint method_splits_key_check;

alter table public.method_enrollments add constraint method_enrollments_next_split_key_format_check
  check (next_split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.method_enrollments validate constraint method_enrollments_next_split_key_format_check;
alter table public.method_enrollments drop constraint method_enrollments_next_split_key_check;

alter table public.session_prescriptions add constraint session_prescriptions_split_key_format_check
  check (split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.session_prescriptions validate constraint session_prescriptions_split_key_format_check;
alter table public.session_prescriptions drop constraint session_prescriptions_split_key_check;

alter table public.workout_sessions add constraint workout_sessions_split_key_format_check
  check (split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.workout_sessions validate constraint workout_sessions_split_key_format_check;
alter table public.workout_sessions drop constraint workout_sessions_split_key_check;

alter table public.method_source_chunks add constraint method_source_chunks_split_key_format_check
  check (split_key is null or split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.method_source_chunks validate constraint method_source_chunks_split_key_format_check;
alter table public.method_source_chunks drop constraint method_source_chunks_split_key_check;
commit;
