-- Four-split method · step 1: generalise the hard-coded push/pull/legs structure.
-- Additive / relaxing only. No existing row is moved, rewritten or deleted.
--
-- Source: docs/method-import/sql/02-draft-migrations.sql (M6, M7, M10) on branch
-- claude/method-import-spec, plus one relaxation the draft missed:
-- method_splits_order_index_check only allowed order_index 1..3.
--
-- Backward compatible: the live code and the existing 1.2 release only use
-- push / pull / legs, which still satisfy every relaxed constraint.

begin;

alter table public.method_splits add constraint method_splits_key_format_check
  check (key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.method_splits validate constraint method_splits_key_format_check;
alter table public.method_splits drop constraint method_splits_key_check;

alter table public.method_splits add constraint method_splits_order_index_v2_check
  check (order_index between 1 and 12) not valid;
alter table public.method_splits validate constraint method_splits_order_index_v2_check;
alter table public.method_splits drop constraint method_splits_order_index_check;

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

-- Day type and cycle membership. Existing rows default to a required strength day,
-- so the 1.2 rotation is unchanged. is_required = false marks an optional day
-- (for example a core day) that never blocks "cycle complete".
alter table public.method_splits
  add column day_type text not null default 'strength'
    check (day_type in ('strength', 'core', 'cardio')),
  add column is_required boolean not null default true;

commit;

begin;

-- Internal helpers. Only called from security definer RPCs; clients must not
-- execute them (Supabase grants EXECUTE on new functions to authenticated by default).
create function public.first_required_split_key(p_enrollment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select split.key
  from public.method_enrollments enrollment
  join public.method_splits split on split.method_release_id = enrollment.method_release_id
  where enrollment.id = p_enrollment_id and split.is_required
  order by split.order_index
  limit 1
$$;
revoke all on function public.first_required_split_key(uuid) from public, anon, authenticated;

create function public.workout_log_type_for_split(p_enrollment_id uuid, p_split_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select split.name_zh
  from public.method_enrollments enrollment
  join public.method_splits split on split.method_release_id = enrollment.method_release_id
  where enrollment.id = p_enrollment_id and split.key = p_split_key
$$;
revoke all on function public.workout_log_type_for_split(uuid, text) from public, anon, authenticated;

commit;
