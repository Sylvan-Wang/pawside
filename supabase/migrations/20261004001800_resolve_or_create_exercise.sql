-- Method import foundation F4: deterministic exercise identity resolution.
begin;
create function public.resolve_or_create_exercise(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n text;
  norm text;
  found uuid;
  draft_count integer;
  final_name text;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  n := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(n) < 1 or length(n) > 40 then
    raise exception 'Invalid exercise name' using errcode = '22023';
  end if;
  norm := lower(regexp_replace(n, '[\s·\-_()（）]', '', 'g'));

  select e.id into found
  from public.exercises e
  where e.review_status = 'reviewed' and e.is_active
    and (lower(regexp_replace(e.canonical_name_zh, '[\s·\-_()（）]', '', 'g')) = norm
         or exists (select 1 from unnest(e.aliases) a
                    where lower(regexp_replace(a, '[\s·\-_()（）]', '', 'g')) = norm))
  order by e.created_at
  limit 1;
  if found is not null then return found; end if;

  select e.id into found
  from public.exercises e
  where e.review_status = 'draft' and e.created_by = uid
    and lower(regexp_replace(e.canonical_name_zh, '[\s·\-_()（）]', '', 'g')) = norm
  limit 1;
  if found is not null then return found; end if;

  select count(*) into draft_count
  from public.exercises e where e.created_by = uid and e.review_status = 'draft';
  if draft_count >= 100 then
    raise exception 'Draft exercise limit reached' using errcode = '54000';
  end if;

  final_name := n;
  if exists (select 1 from public.exercises e where e.canonical_name_zh = final_name) then
    final_name := n || ' · ' || left(replace(gen_random_uuid()::text, '-', ''), 4);
  end if;

  insert into public.exercises (canonical_name_zh, review_status, created_by)
  values (final_name, 'draft', uid)
  returning id into found;
  return found;
end
$$;
revoke all on function public.resolve_or_create_exercise(text) from public, anon;
grant execute on function public.resolve_or_create_exercise(text) to authenticated;
commit;
