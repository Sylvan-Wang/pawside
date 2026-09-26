begin;

do $$
begin
  if to_regclass('public.user_food_memory') is null
     or to_regclass('public.food_resolution_candidates') is null then
    raise exception 'food resolution memory tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.user_food_memory'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'public.user_food_memory'::regclass) then
    raise exception 'user_food_memory must enforce RLS';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.food_resolution_candidates'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'public.food_resolution_candidates'::regclass) then
    raise exception 'food_resolution_candidates must enforce RLS';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'food_resolution_candidates'
      and policyname = 'food_resolution_candidates_read'
      and qual ilike '%created_by%'
  ) then
    raise exception 'provisional candidate cache must remain user-scoped';
  end if;

  if exists (
    select 1
    from pg_constraint
    where contype = 'f'
      and conrelid in (
        'public.user_food_memory'::regclass,
        'public.food_resolution_candidates'::regclass
      )
      and confrelid = 'public.foods'::regclass
  ) then
    raise exception 'non-canonical resolution data must not write through a canonical food FK';
  end if;
end
$$;

rollback;
