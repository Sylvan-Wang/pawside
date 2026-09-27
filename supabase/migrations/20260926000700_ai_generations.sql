-- =============================================================================
-- ai_generations — every AI generation, success AND failure (spec A0-3)
-- =============================================================================
--
-- WHY THIS TABLE EXISTS
-- ----------------------
-- The only persisted AI output so far is ai_generated_content, and it is
-- written ONLY when composeWithEvidence returns ok. Failures (not_configured,
-- timeout, forbidden_claim, untraceable_number, ...) leave no trace at all, so
-- the first question a user complaint raises — "did the AI even run?" — has
-- no answer today. This table is the answer.
--
-- input_snapshot_id is a hash: it proves two generations saw the same input,
-- but it cannot be reversed into that input. This table stores the full
-- payload so any generation can be replayed later if the user base grows
-- enough to need eval infrastructure (spec MUST 7: not built this period).
--
-- It is an OBSERVABILITY log, not a cache and not a truth source:
--   - ai_generated_content  = what the UI shows (cache)
--   - ai_feedback           = what the user thought of it (evaluation signal)
--   - ai_generations        = what actually happened, including failures (trace)
--
-- RESERVED FOR THE FUTURE CHAT ORCHESTRATOR (spec §10, not built this period)
-- ----------------------------------------------------------------------------
-- trace_id / parent_generation_id / invoked_by / turn_index let one chat turn
-- that calls several capabilities be stitched into a single replayable
-- trajectory. 'coach_chat' and 'advisory_plan' are reserved in the surface
-- check even though neither writes through composeWithEvidence yet.
--
-- PRIVACY
-- -------
-- payload contains user-entered text (food names, exercise names, notes).
-- Retention default: 90 days, enforced by a scheduled delete (not part of
-- this migration; see docs/coach note when that job is added).
--
-- NUMBERING NOTE
-- --------------
-- The skeleton this was drafted from (docs/coach/skeletons/pawside-ai-p0-0.zip)
-- used 20260926000400, which collides with the already-merged
-- 20260926000400_canonical_nutrition_runtime.sql. Renumbered to the next free
-- slot after the existing 20260926000600 migration.
-- =============================================================================

create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- What produced it -------------------------------------------------------
  surface text not null check (surface in (
    'workout_session_feedback',
    'meal_feedback',
    'daily_review',
    'weekly_review',
    'advisory_plan',        -- reserved: not yet routed through composeWithEvidence
    'coach_chat'            -- reserved: future orchestrator turns
  )),
  -- The entity the output is about: workout_log_id, date, week_start ...
  scope_id text,

  -- Provenance (same fields ai_feedback requires, so the two tables join) --
  input_snapshot_id text not null,
  prompt_version text not null,
  model text not null,
  evidence_registry_version text,

  -- Replayable input and raw output ---------------------------------------
  -- payload = exactly what composeWithEvidence serialised into the request
  payload jsonb not null,
  -- output = parsed model JSON (null when the provider never returned any)
  output jsonb,

  -- Outcome ----------------------------------------------------------------
  status text not null check (status in ('ok', 'failed')),
  fail_reason text check (fail_reason is null or fail_reason in (
    'not_configured',
    'rate_limited',
    'timeout',
    'upstream_error',
    'invalid_response',
    'unbound_evidence',
    'internal_term',
    'untraceable_number',
    'bare_number',           -- spec A0-4 placeholder mode, not used until then
    'unresolved_placeholder',-- spec A0-4 placeholder mode, not used until then
    'forbidden_claim',
    'unknown_evidence_id',
    'status_escalated',
    'invalid_action'
  )),
  -- e.g. the untraceable number tokens, or "metric_key:status" list
  fail_detail text,
  -- 1 = first try, 2 = the single retry composeWithEvidence performs
  attempt smallint not null default 1 check (attempt between 1 and 5),

  -- Cost / latency (null when not measured, never 0 as a stand-in) ---------
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  tokens_in integer check (tokens_in is null or tokens_in >= 0),
  tokens_out integer check (tokens_out is null or tokens_out >= 0),

  -- Orchestration / tracing (reserved for Coach Chat) ----------------------
  trace_id uuid,                                   -- one per user-visible request / chat turn
  parent_generation_id uuid references public.ai_generations(id) on delete set null,
  invoked_by text not null default 'ui'
    check (invoked_by in ('ui', 'orchestrator', 'schedule', 'eval')),
  turn_index integer,                              -- position inside a chat conversation

  created_at timestamptz not null default now(),

  -- ok  <=> no fail_reason
  constraint ai_generations_status_reason_consistent
    check ((status = 'ok') = (fail_reason is null))
);

comment on table public.ai_generations is
  'Observability log of every AI generation, including failures. Stores the full '
  'payload so any generation can be replayed for evaluation. Not a cache and '
  'never a Method, prescription or nutrition truth source.';

comment on column public.ai_generations.payload is
  'Exact model input (facts, signals, context). Contains user-entered text; '
  'subject to a retention policy (default 90 days, not yet automated).';
comment on column public.ai_generations.trace_id is
  'Groups generations produced by one request or one chat turn (orchestrator, reserved).';
comment on column public.ai_generations.invoked_by is
  'ui = a page called the surface; orchestrator = Coach Chat called it as a tool (reserved); '
  'schedule = pre-generation job; eval = offline eval run.';

-- Indexes -----------------------------------------------------------------
create index if not exists ai_generations_user_created_idx
  on public.ai_generations(user_id, created_at desc);

create index if not exists ai_generations_surface_created_idx
  on public.ai_generations(surface, created_at desc);

create index if not exists ai_generations_snapshot_idx
  on public.ai_generations(input_snapshot_id);

create index if not exists ai_generations_failed_idx
  on public.ai_generations(surface, fail_reason, created_at desc)
  where status = 'failed';

create index if not exists ai_generations_trace_idx
  on public.ai_generations(trace_id)
  where trace_id is not null;

-- RLS: users may insert and read their own rows; nobody updates or deletes
-- through the API (the log is append-only; retention would run as service role).
alter table public.ai_generations enable row level security;
alter table public.ai_generations force row level security;

drop policy if exists ai_generations_select_own on public.ai_generations;
create policy ai_generations_select_own on public.ai_generations
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_generations_insert_own on public.ai_generations;
create policy ai_generations_insert_own on public.ai_generations
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Explicit grants. Spec §8: new tables must not depend on project defaults.
revoke all privileges on table public.ai_generations from anon;
revoke all privileges on table public.ai_generations from authenticated;
grant select, insert on table public.ai_generations to authenticated;
