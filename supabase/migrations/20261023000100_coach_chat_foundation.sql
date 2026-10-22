-- =============================================================================
-- Coach chat foundation (小爪聊天助手, Patch v1.0)
-- =============================================================================
--
-- Additive only. Nothing here changes an existing function, column type or
-- policy, so the released clients keep working unchanged.
--
--   1. feature row `coach_chat`   (off for everyone until granted per user)
--   2. coach_conversations / coach_messages / coach_drafts
--        - drafts are the ONLY thing a chat turn writes. A draft holds the
--          server-validated payload. The confirm endpoint commits THAT payload,
--          never anything the browser sends, so a model (or an injected
--          instruction) can propose but never write.
--        - payload / request_id / kind are frozen by trigger, and status can
--          only move along allowed edges.
--   3. save_food_log_canonical_v2 / replace_food_log_canonical_v2
--        - same contract as v1, plus: an item may have NO weight when it also
--          has NO nutrition ("raw-only": we know what was eaten, not how much);
--          input_mode is a parameter instead of the constant 'manual'.
--        - v1 is untouched. Unknown stays NULL; it is never stored as 0.
--   4. workout_logs: client_request_id (idempotency), calories_burned_kcal
--      (nullable), input_source; save_workout_log_v1.
--
-- Rollback = turn the feature off. The new tables/columns are inert without it.
-- No destructive down-migration is provided on purpose (Patch §12.6).
-- =============================================================================

begin;

-- 1. Feature flag ------------------------------------------------------------

insert into public.app_features (key, note) values
  ('coach_chat', '小爪聊天助手（文字记饮食/运动/体重、查询当天情况）')
on conflict (key) do nothing;

-- 2. Conversations, messages, drafts -----------------------------------------

create table public.coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create index coach_conversations_user_idx
  on public.coach_conversations (user_id, created_at desc);

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.coach_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Set for user messages: a retried send with the same id returns the stored
  -- reply instead of running the turn twice.
  client_message_id uuid,
  -- Assistant messages: the user message this one answers (retry lookup).
  reply_to_message_id uuid references public.coach_messages(id) on delete set null,
  content text not null check (char_length(content) between 1 and 4000),
  -- Assistant messages: [{ "draft_id": uuid }, ...]. Card content is read from
  -- coach_drafts so a card can never drift from what will be committed.
  cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  -- The user's calendar date when the message was sent (display grouping).
  local_date date not null,
  created_at timestamptz not null default now()
);
create unique index coach_messages_client_message_idx
  on public.coach_messages (user_id, client_message_id)
  where client_message_id is not null;
create index coach_messages_conversation_idx
  on public.coach_messages (conversation_id, created_at desc);
create index coach_messages_user_idx
  on public.coach_messages (user_id);
create index coach_messages_reply_to_idx
  on public.coach_messages (reply_to_message_id);

create table public.coach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.coach_conversations(id) on delete cascade,
  message_id uuid references public.coach_messages(id) on delete set null,
  kind text not null check (kind in ('meal', 'meal_edit', 'workout', 'weight')),
  status text not null default 'proposed' check (status in (
    'needs_clarification', 'proposed', 'committing', 'saved',
    'superseded', 'cancelled', 'failed', 'outcome_unknown'
  )),
  version integer not null default 1 check (version >= 1),
  -- Stable for the life of this draft. A content change creates a NEW draft
  -- (new request_id) that supersedes this one, so a retry can never be applied
  -- twice and an edit can never reuse an old receipt.
  request_id uuid not null default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- meal_edit: the canonical user_food_logs.id and the updated_at it was built on.
  target_record_id uuid,
  target_updated_at timestamptz,
  supersedes_id uuid references public.coach_drafts(id) on delete set null,
  -- Patch §3.3: at most one AI-initiated clarification per record task. The
  -- count follows the chain of superseding drafts.
  clarifications_used smallint not null default 0 check (clarifications_used between 0 and 1),
  -- The receipt once saved: { food_log_id | workout_log_id | body_metric_id, ... }.
  result jsonb,
  error_code text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_drafts_request_unique unique (user_id, request_id)
);
create index coach_drafts_conversation_idx
  on public.coach_drafts (conversation_id, created_at desc);
create index coach_drafts_user_open_idx
  on public.coach_drafts (user_id, status)
  where status in ('needs_clarification', 'proposed', 'committing', 'outcome_unknown');
create index coach_drafts_message_idx on public.coach_drafts (message_id);
create index coach_drafts_supersedes_idx on public.coach_drafts (supersedes_id);

comment on table public.coach_drafts is
  'Server-validated proposals from the chat assistant. The only write a chat turn makes; '
  'committing a draft goes through the same canonical RPCs as the manual pages.';

-- A draft can be proposed, confirmed, cancelled or superseded - never rewritten.
create function public.coach_drafts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.conversation_id is distinct from old.conversation_id
       or new.kind is distinct from old.kind
       or new.request_id is distinct from old.request_id
       or new.version is distinct from old.version
       or new.payload is distinct from old.payload
       or new.target_record_id is distinct from old.target_record_id
       or new.target_updated_at is distinct from old.target_updated_at then
      raise exception 'coach draft content is immutable; create a superseding draft'
        using errcode = '23514';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'needs_clarification' and new.status in ('superseded', 'cancelled'))
        or (old.status = 'proposed' and new.status in ('committing', 'superseded', 'cancelled', 'failed'))
        or (old.status = 'committing' and new.status in ('saved', 'proposed', 'failed', 'outcome_unknown'))
        or (old.status = 'outcome_unknown' and new.status in ('committing', 'saved', 'failed'))
      ) then
        raise exception 'illegal coach draft status change % -> %', old.status, new.status
          using errcode = '23514';
      end if;
    elsif old.status in ('saved', 'superseded', 'cancelled', 'failed')
          and (new.result is distinct from old.result) then
      raise exception 'a finished coach draft cannot change' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger coach_drafts_guard_trg
  before update on public.coach_drafts
  for each row execute function public.coach_drafts_guard();

alter table public.coach_conversations enable row level security;
alter table public.coach_messages enable row level security;
alter table public.coach_drafts enable row level security;
alter table public.coach_conversations force row level security;
alter table public.coach_messages force row level security;
alter table public.coach_drafts force row level security;

create policy coach_conversations_own on public.coach_conversations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy coach_messages_own on public.coach_messages
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.coach_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

create policy coach_drafts_own on public.coach_drafts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.coach_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

revoke all on table public.coach_conversations, public.coach_messages, public.coach_drafts
  from public, anon;
grant select, insert, update, delete
  on table public.coach_conversations, public.coach_messages, public.coach_drafts
  to authenticated;

-- 3. Canonical food log v2 (raw-only items, explicit input_mode) --------------

create function public.save_food_log_canonical_v2(
  p_request_id uuid,
  p_log_date date,
  p_meal_type text,
  p_raw_input_text text,
  p_notes text,
  p_items jsonb,
  p_legacy_foods jsonb,
  p_input_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_log_id uuid;
  existing_legacy_id uuid;
  created_log_id uuid;
  created_legacy_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null or p_log_date is null then
    raise exception 'request_id and log_date are required' using errcode = '22023';
  end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'invalid meal_type' using errcode = '22023';
  end if;
  if p_input_mode not in ('manual', 'natural_language', 'ai_assisted') then
    raise exception 'invalid input_mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one food item is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_legacy_foods) <> 'array' then
    raise exception 'legacy foods must be an array' using errcode = '22023';
  end if;
  -- Valid item: has a name; a weight, when present, is positive; and an item
  -- with no weight carries no nutrition (unknown is NULL, never a made-up 0).
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where nullif(btrim(item->>'food_name_raw'), '') is null
       or (nullif(item->>'weight_g', '') is not null and (item->>'weight_g')::numeric <= 0)
       or (
         nullif(item->>'weight_g', '') is null
         and (
           nullif(item->>'energy_kcal', '') is not null
           or nullif(item->>'protein_g', '') is not null
           or nullif(item->>'carb_g', '') is not null
           or nullif(item->>'fat_g', '') is not null
         )
       )
  ) then
    raise exception 'invalid food item' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || p_request_id::text, 0)
  );

  select id into existing_log_id
  from public.user_food_logs
  where user_id = current_user_id and client_request_id = p_request_id;

  if existing_log_id is not null then
    select id into existing_legacy_id
    from public.food_logs
    where user_id = current_user_id and canonical_food_log_id = existing_log_id;

    return jsonb_build_object(
      'food_log_id', existing_log_id,
      'legacy_food_log_id', existing_legacy_id,
      'idempotent', true
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || p_log_date::text, 1)
  );

  insert into public.user_food_logs (
    user_id, log_date, meal_type, input_mode, raw_input_text, notes, client_request_id
  ) values (
    current_user_id, p_log_date, p_meal_type, p_input_mode, p_raw_input_text, p_notes, p_request_id
  ) returning id into created_log_id;

  insert into public.user_food_log_items (
    food_log_id, food_id, food_name_raw, food_name_resolved, weight_g,
    quantity, unit, is_estimated, energy_kcal, protein_g, carb_g, fat_g,
    calculation_basis, status
  )
  select
    created_log_id,
    nullif(item->>'food_id', '')::integer,
    item->>'food_name_raw',
    nullif(item->>'food_name_resolved', ''),
    nullif(item->>'weight_g', '')::numeric,
    nullif(item->>'quantity', '')::numeric,
    nullif(item->>'unit', ''),
    coalesce((item->>'is_estimated')::boolean, false),
    nullif(item->>'energy_kcal', '')::numeric,
    nullif(item->>'protein_g', '')::numeric,
    nullif(item->>'carb_g', '')::numeric,
    nullif(item->>'fat_g', '')::numeric,
    coalesce(item->'calculation_basis', '{}'::jsonb),
    'confirmed'
  from jsonb_array_elements(p_items) item;

  insert into public.food_logs (
    user_id, date, meal_type, foods, notes, canonical_food_log_id
  ) values (
    current_user_id, p_log_date, p_meal_type, p_legacy_foods, p_notes, created_log_id
  ) returning id into created_legacy_id;

  perform public.reconcile_daily_nutrition_summary_v1(current_user_id, p_log_date);

  return jsonb_build_object(
    'food_log_id', created_log_id,
    'legacy_food_log_id', created_legacy_id,
    'idempotent', false
  );
end;
$$;

create function public.replace_food_log_canonical_v2(
  p_food_log_id uuid,
  p_log_date date,
  p_meal_type text,
  p_raw_input_text text,
  p_notes text,
  p_items jsonb,
  p_legacy_foods jsonb,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  old_log_date date;
  current_updated_at timestamptz;
  compatibility_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_food_log_id is null or p_log_date is null then
    raise exception 'food_log_id and log_date are required' using errcode = '22023';
  end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'invalid meal_type' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one food item is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where nullif(btrim(item->>'food_name_raw'), '') is null
       or (nullif(item->>'weight_g', '') is not null and (item->>'weight_g')::numeric <= 0)
       or (
         nullif(item->>'weight_g', '') is null
         and (
           nullif(item->>'energy_kcal', '') is not null
           or nullif(item->>'protein_g', '') is not null
           or nullif(item->>'carb_g', '') is not null
           or nullif(item->>'fat_g', '') is not null
         )
       )
  ) then
    raise exception 'invalid food item' using errcode = '22023';
  end if;

  select log_date, updated_at
    into old_log_date, current_updated_at
  from public.user_food_logs
  where id = p_food_log_id and user_id = current_user_id
  for update;

  if old_log_date is null then
    raise exception 'food log not found' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is not null and current_updated_at <> p_expected_updated_at then
    -- Not 40001: PostgREST retries a 40001 transaction instead of answering, so the
    -- caller would hang (observed on PostgREST 12.2.3). PT409 is returned as HTTP 409.
    raise exception 'food log was updated by another request' using errcode = 'PT409';
  end if;

  if old_log_date <= p_log_date then
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || old_log_date::text, 1));
    if old_log_date <> p_log_date then
      perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_log_date::text, 1));
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_log_date::text, 1));
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || old_log_date::text, 1));
  end if;

  update public.user_food_logs set
    log_date = p_log_date,
    meal_type = p_meal_type,
    raw_input_text = p_raw_input_text,
    notes = p_notes,
    updated_at = now()
  where id = p_food_log_id and user_id = current_user_id;

  delete from public.user_food_log_items where food_log_id = p_food_log_id;

  insert into public.user_food_log_items (
    food_log_id, food_id, food_name_raw, food_name_resolved, weight_g,
    quantity, unit, is_estimated, energy_kcal, protein_g, carb_g, fat_g,
    calculation_basis, status
  )
  select
    p_food_log_id,
    nullif(item->>'food_id', '')::integer,
    item->>'food_name_raw',
    nullif(item->>'food_name_resolved', ''),
    nullif(item->>'weight_g', '')::numeric,
    nullif(item->>'quantity', '')::numeric,
    nullif(item->>'unit', ''),
    coalesce((item->>'is_estimated')::boolean, false),
    nullif(item->>'energy_kcal', '')::numeric,
    nullif(item->>'protein_g', '')::numeric,
    nullif(item->>'carb_g', '')::numeric,
    nullif(item->>'fat_g', '')::numeric,
    coalesce(item->'calculation_basis', '{}'::jsonb),
    'confirmed'
  from jsonb_array_elements(p_items) item;

  update public.food_logs set
    date = p_log_date,
    meal_type = p_meal_type,
    foods = p_legacy_foods,
    notes = p_notes,
    updated_at = now()
  where canonical_food_log_id = p_food_log_id
    and user_id = current_user_id
  returning id into compatibility_id;

  if compatibility_id is null then
    insert into public.food_logs (
      user_id, date, meal_type, foods, notes, canonical_food_log_id
    ) values (
      current_user_id, p_log_date, p_meal_type, p_legacy_foods, p_notes, p_food_log_id
    ) returning id into compatibility_id;
  end if;

  perform public.reconcile_daily_nutrition_summary_v1(current_user_id, old_log_date);
  if p_log_date <> old_log_date then
    perform public.reconcile_daily_nutrition_summary_v1(current_user_id, p_log_date);
  end if;

  return jsonb_build_object(
    'food_log_id', p_food_log_id,
    'legacy_food_log_id', compatibility_id,
    'old_log_date', old_log_date,
    'log_date', p_log_date,
    'updated_at', (select updated_at from public.user_food_logs where id = p_food_log_id)
  );
end;
$$;

revoke all on function public.save_food_log_canonical_v2(uuid, date, text, text, text, jsonb, jsonb, text)
  from public, anon;
revoke all on function public.replace_food_log_canonical_v2(uuid, date, text, text, text, jsonb, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_food_log_canonical_v2(uuid, date, text, text, text, jsonb, jsonb, text)
  to authenticated;
grant execute on function public.replace_food_log_canonical_v2(uuid, date, text, text, text, jsonb, jsonb, timestamptz)
  to authenticated;

-- 4. Free workouts: idempotent write, optional calories ----------------------

alter table public.workout_logs
  add column if not exists client_request_id uuid,
  add column if not exists calories_burned_kcal numeric(8,2)
    check (calories_burned_kcal is null or calories_burned_kcal >= 0),
  add column if not exists input_source text not null default 'manual'
    check (input_source in ('manual', 'coach_chat'));

create unique index if not exists workout_logs_user_request_idx
  on public.workout_logs (user_id, client_request_id)
  where client_request_id is not null;

comment on column public.workout_logs.calories_burned_kcal is
  'Optional, user-stated or null. Never estimated by Pawside; null means unknown, not zero.';

create function public.save_workout_log_v1(
  p_request_id uuid,
  p_date date,
  p_type text,
  p_duration_minutes integer,
  p_notes text,
  p_exercises jsonb,
  p_calories_burned_kcal numeric,
  p_input_source text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_id uuid;
  created_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null or p_date is null then
    raise exception 'request_id and date are required' using errcode = '22023';
  end if;
  if nullif(btrim(p_type), '') is null then
    raise exception 'workout type is required' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'duration must be 1-1440 minutes' using errcode = '22023';
  end if;
  if p_calories_burned_kcal is not null
     and (p_calories_burned_kcal < 0 or p_calories_burned_kcal > 20000) then
    raise exception 'calories out of range' using errcode = '22023';
  end if;
  if p_input_source not in ('manual', 'coach_chat') then
    raise exception 'invalid input_source' using errcode = '22023';
  end if;
  if p_exercises is not null and jsonb_typeof(p_exercises) <> 'array' then
    raise exception 'exercises must be an array' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || p_request_id::text, 0)
  );

  select id into existing_id
  from public.workout_logs
  where user_id = current_user_id and client_request_id = p_request_id;

  if existing_id is not null then
    return jsonb_build_object('workout_log_id', existing_id, 'log_date', p_date, 'idempotent', true);
  end if;

  insert into public.workout_logs (
    user_id, date, type, duration_minutes, notes, exercises,
    client_request_id, calories_burned_kcal, input_source
  ) values (
    current_user_id, p_date, btrim(p_type), p_duration_minutes, p_notes,
    coalesce(p_exercises, '[]'::jsonb),
    p_request_id, p_calories_burned_kcal, p_input_source
  ) returning id into created_id;

  return jsonb_build_object('workout_log_id', created_id, 'log_date', p_date, 'idempotent', false);
end;
$$;

revoke all on function public.save_workout_log_v1(uuid, date, text, integer, text, jsonb, numeric, text)
  from public, anon;
grant execute on function public.save_workout_log_v1(uuid, date, text, integer, text, jsonb, numeric, text)
  to authenticated;

commit;
