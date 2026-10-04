-- Method import B7: atomically publish one reviewed import as an immutable private method.
begin;
create function public.create_private_method_v1(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid(); imported record; manifest jsonb;
  method_id uuid; release_id uuid; source_id uuid; split_id uuid; exercise_id uuid; rule_id uuid;
  day jsonb; exercise jsonb; set_item jsonb;
  day_index integer; exercise_index integer; set_index integer;
  rule_key text; authority text;
begin
  if not public.feature_enabled('method_import') then raise exception 'Feature not enabled' using errcode = '42501'; end if;
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into imported from public.user_method_imports i where i.id = p_import_id and i.user_id = uid for update;
  if imported.id is null then raise exception 'Import not found' using errcode = 'P0002'; end if;
  if imported.published_method_id is not null then
    select r.id into release_id from public.method_releases r
    where r.method_id = imported.published_method_id and r.status = 'active' order by r.created_at desc limit 1;
    return jsonb_build_object('method_id', imported.published_method_id, 'release_id', release_id, 'idempotent', true);
  end if;
  if imported.status <> 'review' or imported.manifest_draft is null then raise exception 'Import is not ready for publishing' using errcode = '55000'; end if;
  if imported.consent_version is null or imported.consented_at is null then raise exception 'Consent is required' using errcode = '22023'; end if;
  if (select count(*) from public.methods m where m.owner_user_id = uid and m.hidden_at is null) >= 10 then
    raise exception 'Private method limit reached' using errcode = '54000';
  end if;
  manifest := imported.manifest_draft;
  if (manifest->>'schemaVersion')::integer <> 2 or jsonb_typeof(manifest->'days') <> 'array'
     or jsonb_array_length(manifest->'days') not between 1 and 14
     or nullif(btrim(manifest#>>'{method,nameZh}'), '') is null then
    raise exception 'Invalid method manifest' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(manifest->'days') d
    where ((d->>'dayType') = 'strength' and coalesce((d->>'required')::boolean, false) = false)
       or ((d->>'dayType') in ('core', 'cardio') and coalesce((d->>'required')::boolean, true) = true)
  ) then raise exception 'Invalid required-day policy' using errcode = '22023'; end if;
  if not exists (select 1 from jsonb_array_elements(manifest->'days') d where (d->>'required')::boolean) then
    raise exception 'At least one required day is needed' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(manifest->'days') d,
      jsonb_array_elements(d->'exercises') e, jsonb_array_elements(e->'sets') s
    where (s#>>'{reps,authority}' = 'method_explicit' and nullif(btrim(s#>>'{reps,quote}'), '') is null)
       or (s#>>'{durationSeconds,authority}' = 'method_explicit' and nullif(btrim(s#>>'{durationSeconds,quote}'), '') is null)
       or (s#>>'{distanceM,authority}' = 'method_explicit' and nullif(btrim(s#>>'{distanceM,quote}'), '') is null)
       or (s#>>'{restSeconds,authority}' = 'method_explicit' and nullif(btrim(s#>>'{restSeconds,quote}'), '') is null)
  ) then raise exception 'method_explicit values require quotes' using errcode = '22023'; end if;

  insert into public.methods (key, name, version, status, description, source_type, source_metadata, owner_user_id)
  values ('user_' || left(replace(uid::text, '-', ''), 8) || '_' || left(replace(imported.id::text, '-', ''), 8),
    left(manifest#>>'{method,nameZh}', 80), '1.0', 'active', manifest#>>'{method,summary}', 'imported',
    jsonb_build_object('import_id', imported.id, 'schema_version', 2), uid) returning id into method_id;
  insert into public.method_releases (
    method_id, version, status, release_channel, release_policy, runtime_gate_status,
    strict_gate_status, source_set_checksum_sha256, validation_report_json, validated_at, release_notes
  ) values (method_id, '1.0', 'validated', 'internal_beta', 'v1_runtime', 'passed', 'pending',
    imported.text_checksum_sha256, jsonb_build_object('source', 'method_import', 'open_questions', imported.open_questions_count),
    now(), 'Published from a user-reviewed pasted-text import.') returning id into release_id;
  insert into public.method_source_documents (
    method_id, source_key, source_type, title, version, checksum_sha256, status, metadata_json
  ) values (method_id, 'user-import-' || imported.id::text, 'user_text',
    coalesce(manifest#>>'{source,title}', manifest#>>'{method,nameZh}'), '1.0', imported.text_checksum_sha256,
    'ingested', jsonb_build_object('import_id', imported.id, 'owner_user_id', uid)) returning id into source_id;

  day_index := 0;
  for day in select value from jsonb_array_elements(manifest->'days') loop
    day_index := day_index + 1;
    if (day->>'key') !~ '^[a-z][a-z0-9_]{1,31}$' or (day->>'order')::integer not between 1 and 14 then
      raise exception 'Invalid Program Day' using errcode = '22023';
    end if;
    insert into public.method_splits (
      method_id, method_release_id, key, name_zh, order_index, primary_focus,
      description, day_type, is_required, min_gap_days
    ) values (method_id, release_id, day->>'key', left(day->>'nameZh', 40), (day->>'order')::integer,
      array(select jsonb_array_elements_text(coalesce(day->'focusRegions', '[]'::jsonb))), null,
      day->>'dayType', (day->>'required')::boolean, coalesce((day->>'minGapDays')::integer, 0)) returning id into split_id;

    exercise_index := 0;
    for exercise in select value from jsonb_array_elements(day->'exercises') loop
      exercise_index := exercise_index + 1;
      if exercise_index > 12 then raise exception 'Too many exercises in a day' using errcode = '22023'; end if;
      exercise_id := nullif(exercise#>>'{ref,exerciseId}', '')::uuid;
      if exercise_id is null then exercise_id := public.resolve_or_create_exercise(exercise#>>'{ref,name}'); end if;
      if not exists (select 1 from public.exercises e where e.id = exercise_id and (e.review_status = 'reviewed' or e.created_by = uid)) then
        raise exception 'Exercise is not visible' using errcode = '42501';
      end if;
      rule_key := 'RX-' || lpad(day_index::text, 2, '0') || '-' || lpad(exercise_index::text, 2, '0');
      authority := coalesce(exercise#>>'{sets,0,reps,authority}', exercise#>>'{sets,0,durationSeconds,authority}', exercise#>>'{sets,0,distanceM,authority}', 'unresolved');
      insert into public.method_rules (
        method_id, method_release_id, rule_key, rule_type, version, config_json,
        explanation_zh, status, source_authority, runtime_status, confidence,
        source_note, canonical_status, evidence_required, config_schema_version
      ) values (method_id, release_id, rule_key, 'prescription', '1.0',
        jsonb_build_object('schema', 'private-method-prescription-v1', 'summary_zh', exercise#>>'{ref,name}'),
        exercise->>'notes', 'active', authority, case when authority = 'ai_inferred' then 'inactive' else 'active' end,
        case when authority = 'ai_inferred' then 'low' else 'high' end,
        'User-reviewed private method import.', 'active', false, 1) returning id into rule_id;
      insert into public.method_split_exercises (
        method_split_id, exercise_id, order_index, method_role, prescription_rule_key,
        progression_rule_key, method_notes, field_provenance
      ) values (split_id, exercise_id, exercise_index, exercise->>'role', rule_key, null,
        exercise->>'notes', jsonb_build_object('import_id', imported.id));

      set_index := 0;
      for set_item in select value from jsonb_array_elements(exercise->'sets') loop
        set_index := set_index + 1;
        if set_index > 40 then raise exception 'Too many sets' using errcode = '22023'; end if;
        insert into public.method_runtime_set_templates (
          method_release_id, method_rule_id, set_index, set_type, target_reps_min,
          target_reps_max, failure_allowed, failure_required, rest_min_seconds,
          rest_max_seconds, quality_requirement, source_authority, evidence_key,
          is_optional, target_duration_seconds, target_distance_m
        ) values (release_id, rule_id, set_index, set_item->>'type',
          nullif(set_item#>>'{reps,value,min}', '')::integer, nullif(set_item#>>'{reps,value,max}', '')::integer,
          set_item->>'failure' in ('allowed', 'required'), set_item->>'failure' = 'required',
          nullif(set_item#>>'{restSeconds,value,min}', '')::integer, nullif(set_item#>>'{restSeconds,value,max}', '')::integer,
          set_item->>'qualityNote', authority,
          coalesce(set_item#>>'{reps,quote}', set_item#>>'{durationSeconds,quote}', set_item#>>'{distanceM,quote}'),
          coalesce((set_item->>'optional')::boolean, false), nullif(set_item#>>'{durationSeconds,value}', '')::integer,
          nullif(set_item#>>'{distanceM,value}', '')::numeric);
      end loop;
    end loop;
  end loop;
  update public.method_releases set status = 'active', activated_at = now() where id = release_id;
  update public.user_method_imports set status = 'published', published_method_id = method_id,
    raw_text_purge_after = now() + interval '30 days', updated_at = now() where id = imported.id;
  return jsonb_build_object('method_id', method_id, 'release_id', release_id, 'source_document_id', source_id, 'idempotent', false);
end;
$$;
revoke all on function public.create_private_method_v1(uuid) from public, anon;
grant execute on function public.create_private_method_v1(uuid) to authenticated;
commit;
