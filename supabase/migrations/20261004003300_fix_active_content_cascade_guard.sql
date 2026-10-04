-- Fix: `protect_active_method_content()` referenced `old.method_id` for every
-- table it is attached to, but `method_split_exercises` has no `method_id`
-- column. Any insert of a canonical exercise into a release therefore aborted
-- with `record "old" has no field "method_id"`, which broke
-- `create_private_method_v1` (B7) and the reviewed-import path end to end.
--
-- The cascade guard is also narrowed to the two tables that actually carry
-- `method_id`. Cascades originating from other children (for example a split
-- exercise removed with its split) are recognised through the release row: when
-- the account owner's method row is already gone, `method_releases` is gone too,
-- so there is no release left to protect.
begin;
create or replace function public.protect_active_method_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_id_to_check uuid;
  parent_method_id uuid;
begin
  if tg_table_name in ('method_splits', 'method_rules') then
    if tg_op = 'DELETE' then
      if not exists (select 1 from public.methods m where m.id = old.method_id) then
        return old;
      end if;
      release_id_to_check := old.method_release_id;
    else
      -- An insert has no previous row, so reading old.method_id would raise.
      release_id_to_check := new.method_release_id;
    end if;
  elsif tg_table_name = 'method_split_exercises' then
    select s.method_release_id, s.method_id
    into release_id_to_check, parent_method_id
    from public.method_splits s
    where s.id = case when tg_op = 'DELETE' then old.method_split_id else new.method_split_id end;
    if tg_op = 'DELETE' and parent_method_id is not null
       and not exists (select 1 from public.methods m where m.id = parent_method_id) then
      return old;
    end if;
  elsif tg_table_name = 'method_rule_sources' then
    select r.method_release_id, r.method_id
    into release_id_to_check, parent_method_id
    from public.method_rules r
    where r.id = case when tg_op = 'DELETE' then old.method_rule_id else new.method_rule_id end;
    if tg_op = 'DELETE' and parent_method_id is not null
       and not exists (select 1 from public.methods m where m.id = parent_method_id) then
      return old;
    end if;
  elsif tg_table_name = 'method_prescription_field_values' then
    select s.method_release_id, s.method_id
    into release_id_to_check, parent_method_id
    from public.method_split_exercises mse
    join public.method_splits s on s.id = mse.method_split_id
    where mse.id = case
      when tg_op = 'DELETE' then old.method_split_exercise_id
      else new.method_split_exercise_id
    end;
    if tg_op = 'DELETE' and parent_method_id is not null
       and not exists (select 1 from public.methods m where m.id = parent_method_id) then
      return old;
    end if;
  elsif tg_table_name = 'method_release_issues' then
    release_id_to_check := case when tg_op = 'DELETE' then old.method_release_id else new.method_release_id end;
  end if;

  if release_id_to_check is not null and exists (
    select 1 from public.method_releases r
    where r.id = release_id_to_check and r.status = 'active'
  ) then
    -- The default SQLSTATE is kept: `multi_day_method_contract.sql` already
    -- catches this message with `when raise_exception`.
    raise exception 'Canonical rows in an active Method release are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_active_method_content() from public, anon, authenticated;
commit;
