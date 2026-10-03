-- Method import foundation F3: preserve active-release protection while allowing account deletion cascades.
begin;
create or replace function public.protect_active_method_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'active' and exists (select 1 from public.methods m where m.id = old.method_id) then
      raise exception 'Active Method releases cannot be deleted';
    end if;
    return old;
  end if;

  if old.status = 'active' then
    if new.status = 'retired'
       and (to_jsonb(new) - array['status', 'retired_at']) =
           (to_jsonb(old) - array['status', 'retired_at']) then
      return new;
    end if;
    raise exception 'Active Method releases are immutable; create a new release';
  end if;

  return new;
end;
$$;

create or replace function public.protect_active_method_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_id_to_check uuid;
begin
  if tg_op = 'DELETE' and tg_table_name in ('method_splits', 'method_rules')
     and not exists (select 1 from public.methods m where m.id = old.method_id) then
    return old;
  end if;

  if tg_table_name in ('method_splits', 'method_rules') then
    if tg_op = 'DELETE' then
      release_id_to_check := old.method_release_id;
    else
      release_id_to_check := new.method_release_id;
    end if;
  elsif tg_table_name = 'method_split_exercises' then
    select s.method_release_id
    into release_id_to_check
    from public.method_splits s
    where s.id = case when tg_op = 'DELETE' then old.method_split_id else new.method_split_id end;
  end if;

  if exists (
    select 1 from public.method_releases r
    where r.id = release_id_to_check and r.status = 'active'
  ) then
    raise exception 'Canonical rows in an active Method release are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
commit;
