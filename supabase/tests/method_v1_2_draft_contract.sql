-- Run after 20260909000600_method_v1_2_validated_draft.sql.

do $test$
declare
  target_release_id uuid;
  target_status text;
  target_release_channel text;
  target_runtime_gate text;
  target_activated_at timestamptz;
  split_count integer;
  exercise_count integer;
  default_field_count integer;
  runtime_blocker_count integer;
  strict_blocker_count integer;
begin
  select id, status, release_channel, runtime_gate_status, activated_at
  into target_release_id, target_status, target_release_channel, target_runtime_gate, target_activated_at
  from public.method_releases
  where version = '1.2'
    and workbook_checksum_sha256 = '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd';

  if target_release_id is null then
    raise exception 'Canonical Method release 1.2 is missing';
  end if;

  -- Fresh databases stop at the validated internal-beta candidate. Production
  -- may have activated the exact immutable checksum after the runtime gate
  -- passed. Both are valid terminal states; production activation is not a
  -- draft-contract failure.
  if target_status not in ('validated', 'active') then
    raise exception 'Release 1.2 must be validated or active, found %', target_status;
  end if;

  if target_runtime_gate <> 'passed' then
    raise exception 'Release 1.2 runtime gate must pass, found %', target_runtime_gate;
  end if;

  if target_status = 'active' and (
    target_release_channel <> 'internal_beta'
    or target_activated_at is null
  ) then
    raise exception
      'Active release 1.2 must be an activated internal beta, found channel=% activated_at=%',
      target_release_channel, target_activated_at;
  end if;

  if target_status = 'validated' and target_activated_at is not null then
    raise exception 'Validated release 1.2 must not carry an activation timestamp';
  end if;

  select count(*) into split_count
  from public.method_splits
  where method_release_id = target_release_id;

  select count(*) into exercise_count
  from public.method_split_exercises mse
  join public.method_splits split on split.id = mse.method_split_id
  where split.method_release_id = target_release_id;

  select count(*) into default_field_count
  from public.method_prescription_field_values field
  join public.method_split_exercises mse on mse.id = field.method_split_exercise_id
  join public.method_splits split on split.id = mse.method_split_id
  where split.method_release_id = target_release_id
    and field.source_authority = 'product_execution_default';

  select
    count(*) filter (where blocks_v1_runtime_release and status <> 'resolved'),
    count(*) filter (where blocks_strict_method_release and status <> 'resolved')
  into runtime_blocker_count, strict_blocker_count
  from public.method_release_issues
  where method_release_id = target_release_id;

  if split_count <> 3 or exercise_count <> 15 then
    raise exception 'Expected 3 splits and 15 exercises, found % and %', split_count, exercise_count;
  end if;

  if default_field_count <> 13 then
    raise exception 'Expected 13 product-default fields, found %', default_field_count;
  end if;

  if runtime_blocker_count <> 0 or strict_blocker_count <> 2 then
    raise exception
      'Expected runtime blockers=0 and strict blockers=2, found % and %',
      runtime_blocker_count, strict_blocker_count;
  end if;

  if exists (
    select 1
    from public.method_prescription_field_values field
    join public.method_split_exercises mse on mse.id = field.method_split_exercise_id
    join public.method_splits split on split.id = mse.method_split_id
    where split.method_release_id = target_release_id
      and field.field_key = 'progression'
      and (
        field.value_json->>'type' <> 'calibration_only'
        or field.value_json->>'method_stage' is not null
      )
  ) then
    raise exception 'P0 defaults must not create or advance method_stage';
  end if;
end;
$test$;

select jsonb_build_object(
  'release', '1.2',
  'status', release.status,
  'runtime_gate', release.runtime_gate_status,
  'strict_gate', release.strict_gate_status,
  'activated_at', release.activated_at
) as method_v1_2_draft_contract
from public.method_releases release
where release.version = '1.2'
  and release.workbook_checksum_sha256 = '52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd';
