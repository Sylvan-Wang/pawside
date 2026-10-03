-- Method import foundation F2: soft deletion of method workout sessions.
begin;
alter table public.workout_sessions add column deleted_at timestamptz;
commit;
