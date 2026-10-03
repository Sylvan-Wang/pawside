-- Method import foundation F2: exercise review status, ownership, record shape, and redirects.
begin;
alter table public.exercises
  add column review_status text not null default 'reviewed'
    check (review_status in ('draft', 'reviewed')),
  add column created_by uuid references auth.users(id) on delete set null,
  add column record_shape text not null default 'weight_reps'
    check (record_shape in ('weight_reps', 'bodyweight_reps', 'duration', 'distance_duration', 'assisted_bodyweight'));

drop policy exercises_authenticated_read on public.exercises;
create policy exercises_read_reviewed_or_own on public.exercises
  for select to authenticated
  using (review_status = 'reviewed' or created_by = (select auth.uid()));

create table public.exercise_redirects (
  from_exercise_id uuid primary key references public.exercises(id) on delete restrict,
  to_exercise_id uuid not null references public.exercises(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  check (from_exercise_id <> to_exercise_id)
);
alter table public.exercise_redirects enable row level security;
revoke all on table public.exercise_redirects from anon, authenticated;
grant select on table public.exercise_redirects to authenticated;
create policy exercise_redirects_authenticated_read on public.exercise_redirects
  for select to authenticated using (true);

create function public.canonical_exercise_id(p_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  cur uuid := p_id;
  nxt uuid;
  depth int := 0;
begin
  loop
    select r.to_exercise_id into nxt from public.exercise_redirects r where r.from_exercise_id = cur;
    exit when nxt is null;
    cur := nxt;
    depth := depth + 1;
    if depth > 8 then
      raise exception 'exercise redirect chain too deep for %', p_id;
    end if;
  end loop;
  return cur;
end
$$;
revoke all on function public.canonical_exercise_id(uuid) from public, anon;
grant execute on function public.canonical_exercise_id(uuid) to authenticated;
commit;
