-- Behaviour contract: reviewed pasted text -> immutable private Method content.
-- rollback-only: no fixture survives this transaction.
begin;

do $test$
declare
  owner_id uuid := gen_random_uuid();
  exercise_id uuid;
  substitute_id uuid;
  import_id uuid;
  rejected_import_id uuid;
  manifest jsonb;
  rejected_manifest jsonb;
  result jsonb;
  v_method_id uuid;
  v_release_id uuid;
  n integer;
begin
  insert into auth.users (id, email) values (owner_id, 'private-publish-contract@example.test');
  insert into public.user_features (user_id, feature_key) values (owner_id, 'method_import');
  select id into exercise_id from public.exercises where review_status = 'reviewed' order by created_at limit 1;
  select id into substitute_id from public.exercises where review_status = 'reviewed' and id <> exercise_id order by created_at limit 1;
  substitute_id := coalesce(substitute_id, exercise_id);
  if exercise_id is null then raise exception 'publish fixture failed: no reviewed exercise'; end if;

  manifest := jsonb_build_object(
    'schemaVersion', 2,
    'method', jsonb_build_object('nameZh', '肩部训练实测', 'summary', '来自用户粘贴文字', 'level', 'beginner', 'equipmentRequirement', null),
    'source', jsonb_build_object('kind', 'pasted_text', 'checksumSha256', repeat('c', 64), 'title', '肩部训练'),
    'days', jsonb_build_array(jsonb_build_object(
      'key', 'shoulders', 'nameZh', '肩部日', 'order', 1, 'dayType', 'strength',
      'required', true, 'minGapDays', 0, 'focusRegions', jsonb_build_array('肩部'),
      'warmupNotes', jsonb_build_array('先做肩关节热身'), 'cooldownNotes', jsonb_build_array('训练后放松'),
      'exercises', jsonb_build_array(jsonb_build_object(
        'ref', jsonb_build_object('name', '杠铃卧推', 'exerciseId', exercise_id, 'match', 'exact'),
        'role', 'primary',
        'sets', jsonb_build_array(
          jsonb_build_object('type', 'working', 'reps', jsonb_build_object('value', jsonb_build_object('min', 8, 'max', 10, 'perSide', false), 'authority', 'method_explicit', 'quote', '每组 8 至 10 次', 'confidence', 'high', 'note', null), 'durationSeconds', null, 'distanceM', null, 'restSeconds', jsonb_build_object('value', jsonb_build_object('min', 60, 'max', 60), 'authority', 'method_explicit', 'quote', '组间休息 60 秒', 'confidence', 'high', 'note', null), 'failure', 'avoid', 'optional', false, 'qualityNote', null),
          jsonb_build_object('type', 'working', 'reps', jsonb_build_object('value', jsonb_build_object('min', 8, 'max', 10, 'perSide', false), 'authority', 'method_explicit', 'quote', '每组 8 至 10 次', 'confidence', 'high', 'note', null), 'durationSeconds', null, 'distanceM', null, 'restSeconds', jsonb_build_object('value', jsonb_build_object('min', 60, 'max', 60), 'authority', 'method_explicit', 'quote', '组间休息 60 秒', 'confidence', 'high', 'note', null), 'failure', 'avoid', 'optional', false, 'qualityNote', null),
          jsonb_build_object('type', 'working', 'reps', jsonb_build_object('value', jsonb_build_object('min', 8, 'max', 10, 'perSide', false), 'authority', 'method_explicit', 'quote', '每组 8 至 10 次', 'confidence', 'high', 'note', null), 'durationSeconds', null, 'distanceM', null, 'restSeconds', jsonb_build_object('value', jsonb_build_object('min', 60, 'max', 60), 'authority', 'method_explicit', 'quote', '组间休息 60 秒', 'confidence', 'high', 'note', null), 'failure', 'avoid', 'optional', false, 'qualityNote', null)
        ),
        'substitutions', jsonb_build_array(jsonb_build_object('name', '替代动作', 'exerciseId', substitute_id, 'match', 'exact')),
        'cues', jsonb_build_array('保持动作稳定'), 'notes', null
      ))
    )),
    'openQuestions', '[]'::jsonb,
    'consent', jsonb_build_object('version', 'health-v1', 'acceptedAt', '2026-10-04T00:00:00.000Z')
  );

  insert into public.user_method_imports (
    user_id, status, raw_text, text_checksum_sha256, manifest_draft,
    open_questions_count, consent_version, consented_at
  ) values (
    owner_id, 'review', '杠铃卧推做 3 组，每组 8 至 10 次，组间休息 60 秒。先做肩关节热身，训练后放松。',
    repeat('c', 64), manifest, 0, 'health-v1', now()
  ) returning id into import_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  result := public.create_private_method_v1(import_id);
  execute 'reset role';

  v_method_id := (result->>'method_id')::uuid;
  v_release_id := (result->>'release_id')::uuid;
  if not exists (select 1 from public.methods where id = v_method_id and owner_user_id = owner_id) then
    raise exception 'publish failed: owned method missing';
  end if;
  if not exists (select 1 from public.method_releases where id = v_release_id and status = 'active') then
    raise exception 'publish failed: active release missing';
  end if;
  select count(*) into n from public.method_prescription_field_values f
  join public.method_split_exercises mse on mse.id = f.method_split_exercise_id
  join public.method_splits s on s.id = mse.method_split_id
  where s.method_release_id = v_release_id and f.source_authority = 'method_explicit'
    and f.evidence_key is not null and f.runtime_status = 'active';
  if n <> 6 then raise exception 'publish failed: expected 6 sourced fields, got %', n; end if;
  if (select count(*) from public.method_runtime_set_templates where method_release_id = v_release_id) <> 3 then
    raise exception 'publish failed: runtime set templates missing';
  end if;
  if not exists (select 1 from public.method_rules where method_release_id = v_release_id and rule_type = 'substitution')
     or not exists (select 1 from public.method_rules where method_release_id = v_release_id and rule_type = 'warmup') then
    raise exception 'publish failed: imported supporting rules missing';
  end if;
  if not exists (select 1 from public.user_method_imports i where i.id = import_id and i.status = 'published' and i.published_method_id = v_method_id) then
    raise exception 'publish failed: import state not finalized';
  end if;

  rejected_manifest := jsonb_set(manifest, '{days,0,exercises,0,sets,0,reps,quote}', '"不存在的引用"'::jsonb);
  insert into public.user_method_imports (
    user_id, status, raw_text, text_checksum_sha256, manifest_draft,
    open_questions_count, consent_version, consented_at
  ) values (
    owner_id, 'review', '杠铃卧推做 3 组，每组 8 至 10 次，组间休息 60 秒。',
    repeat('d', 64), rejected_manifest, 0, 'health-v1', now()
  ) returning id into rejected_import_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  begin
    perform public.create_private_method_v1(rejected_import_id);
    raise exception 'publish guard failed: invalid source quote was accepted';
  exception when invalid_parameter_value then null;
  end;
  execute 'reset role';
end;
$test$;

select jsonb_build_object(
  'contract', 'private-method-publish-v1',
  'covers', jsonb_build_array('reviewed import publish', 'field provenance', 'runtime templates', 'supporting rules', 'invalid quote rejection')
) as private_method_publish_contract;

rollback;
