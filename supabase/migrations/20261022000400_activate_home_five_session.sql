-- Activate the two home-training releases (居家轻力量·徒手版 / 小器械版).
-- Activation only makes them appear in the method list. Nobody is enrolled automatically:
-- users pick a method from the list, and existing enrollments are not touched.
-- Run after 20261022000100 .. 000300. Idempotent: does nothing if already active.

begin;

do $activate$
declare
  n integer;
begin
  update public.method_releases r
  set status = 'active'
  from public.methods m
  where m.id = r.method_id
    and m.key in ('home_bodyweight_five_2026', 'home_dumbbell_five_2026')
    and r.version = '1.0'
    and r.status = 'validated';
  get diagnostics n = row_count;

  if not exists (
    select 1 from public.method_releases r join public.methods m on m.id = r.method_id
    where m.key = 'home_bodyweight_five_2026' and r.status = 'active'
  ) or not exists (
    select 1 from public.method_releases r join public.methods m on m.id = r.method_id
    where m.key = 'home_dumbbell_five_2026' and r.status = 'active'
  ) then
    raise exception 'home five-session releases are not both active (activated % now); was 20261022000200 applied?', n;
  end if;
end;
$activate$;

commit;
