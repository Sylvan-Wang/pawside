-- Fix B2/A2 optional-set materialisation: session_prescriptions identify the
-- release through method_splits, not a direct method_release_id column.
begin;
create or replace function public.copy_runtime_set_optional_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select coalesce(template.is_optional, false) into new.is_optional
  from public.exercise_prescriptions ep
  join public.session_prescriptions sp on sp.id = ep.session_prescription_id
  join public.method_splits split on split.id = sp.method_split_id
  join public.method_split_exercises mse
    on mse.method_split_id = split.id and mse.exercise_id = ep.exercise_id
  join public.method_rules rule
    on rule.method_release_id = split.method_release_id and rule.rule_key = mse.prescription_rule_key
  join public.method_runtime_set_templates template
    on template.method_rule_id = rule.id and template.set_index = new.set_index
  where ep.id = new.exercise_prescription_id;
  new.is_optional := coalesce(new.is_optional, false);
  return new;
end;
$$;
revoke all on function public.copy_runtime_set_optional_flag() from public, anon, authenticated;
commit;
