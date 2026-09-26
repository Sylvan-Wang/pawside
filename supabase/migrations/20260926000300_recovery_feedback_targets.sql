-- Pawside — Phase B storage: recovery check-in, scoped AI feedback, nutrition targets.
--
begin;

-- ---------------------------------------------------------------------------
-- 1. recovery_checkins — Product Patch §6.2 / §7 (Recovery V1)
-- ---------------------------------------------------------------------------
-- Two subjective self-reports only. Product §6.1 explicitly excludes sleep
-- stages, HRV, resting HR, wearables and any "recovery score", and AI Patch §19
-- classifies these as Evidence D signals that may be described but never turned
-- into a medical judgement.
--
-- Deliberately NOT linked to Method recovery. `session_prescriptions.recovery_decision_id`
-- is a dangling FK whose own comment says "Phase 7 adds the FK after
-- recovery_decisions exists"; that table does not exist. Wiring the subjective
-- check-in into Method prescription adjustment is out of scope (AI Patch §37
-- puts objective recovery at P2). Recorded as FOLLOW_UP.

create table if not exists public.recovery_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  /** Local natural day the check-in belongs to (Product §7: max once per day). */
  checkin_date date not null,
  /** Null = not answered. Never coerced to a default such as 3 (Product §27). */
  sleep_quality_self_report smallint
    check (sleep_quality_self_report is null or sleep_quality_self_report between 1 and 5),
  /** Null also covers "no previous training" (Product §7). */
  post_workout_recovery_self_report smallint
    check (post_workout_recovery_self_report is null or post_workout_recovery_self_report between 1 and 5),
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Product §7: at most one check-in per user per local day. Re-answering
  -- updates the same row instead of creating a second prompt.
  unique (user_id, checkin_date)
);

create index if not exists recovery_checkins_user_date_idx
  on public.recovery_checkins(user_id, checkin_date desc);

comment on table public.recovery_checkins is
  'Recovery V1 subjective self-reports (Product Patch §6-§8). Context only: never '
  'auto-adjusts training, never produces a recovery score, never implies a medical '
  'conclusion (AI Patch §19).';

drop trigger if exists recovery_checkins_set_updated_at on public.recovery_checkins;
create trigger recovery_checkins_set_updated_at
  before update on public.recovery_checkins
  for each row execute function public.set_updated_at();

alter table public.recovery_checkins enable row level security;
alter table public.recovery_checkins force row level security;

drop policy if exists recovery_checkins_manage_own on public.recovery_checkins;
create policy recovery_checkins_manage_own on public.recovery_checkins
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. ai_feedback — scoped feedback with full provenance
-- ---------------------------------------------------------------------------
-- Why not reuse `ai_generated_content.feedback`:
--   * it is keyed by (user_id, content_type, target_date) with a UNIQUE
--     constraint, so it structurally cannot hold two ratings for two workouts
--     on the same day — Product §12.1 / AC-P09 require per-session feedback;
--   * Product §14 permits showing 👍/👎 only when the backend can also store
--     scope_id, prompt_version, model_version and an input snapshot.
--
-- `scope`/`scope_id` therefore identify WHAT was rated, independent of the day.

create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  /** Which surface produced the content: session recap, meal, daily, weekly. */
  content_type text not null
    check (content_type in ('workout_session_feedback', 'meal_feedback', 'daily_review', 'weekly_review')),
  /** Granularity of the rating target. */
  scope text not null check (scope in ('session', 'meal', 'day', 'week')),
  /** The rated entity: workout session id, food log id, date, or week start. */
  scope_id text not null,
  /** Correlates to the stored input snapshot used to generate the content. */
  input_snapshot_id text,
  prompt_version text,
  model text,
  model_version text,
  evidence_registry_version text,
  /** The generated payload that was rated, retained verbatim for eval. */
  output_json jsonb,
  rating text check (rating is null or rating in ('liked', 'disliked')),
  created_at timestamptz not null default now(),
  rated_at timestamptz
);

create index if not exists ai_feedback_user_scope_idx
  on public.ai_feedback(user_id, scope, scope_id);

-- One rating per rated entity per content type.
create unique index if not exists ai_feedback_one_rating_idx
  on public.ai_feedback(user_id, content_type, scope_id);

comment on table public.ai_feedback is
  'Scoped AI feedback with provenance (AI Patch §32.1). A user rating is an '
  'evaluation signal only: it is not online training, and the UI must not imply '
  'the model learns immediately (AI Patch §33 / AC-AI13).';

alter table public.ai_feedback enable row level security;
alter table public.ai_feedback force row level security;

drop policy if exists ai_feedback_manage_own on public.ai_feedback;
create policy ai_feedback_manage_own on public.ai_feedback
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. nutrition_targets — persisted macro recommendation + provenance
-- ---------------------------------------------------------------------------
-- Product §4.1 keeps the three macro targets DERIVED rather than hand-entered,
-- and AI Patch §12.1 requires `calculation_basis` to be stored alongside them so
-- a displayed number can always be traced back to its inputs. Storing only the
-- final grams would lose that provenance (Phase 0 map §4.1 gap B).
--
-- `source` records which basis produced the row, so a legacy `|| 2000`
-- fallback can never masquerade as a user-set target (Guardrail §3).

create table if not exists public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_date date not null,
  calorie_target_kcal integer check (calorie_target_kcal is null or calorie_target_kcal > 0),
  protein_target_g numeric(8,2) check (protein_target_g is null or protein_target_g >= 0),
  carb_target_g numeric(8,2) check (carb_target_g is null or carb_target_g >= 0),
  fat_target_g numeric(8,2) check (fat_target_g is null or fat_target_g >= 0),
  /** Distinguishes a user-set target from a derived/assumed one. */
  source text not null default 'user_target'
    check (source in ('user_target', 'derived_macro', 'estimated_legacy', 'pawside_default_legacy', 'missing')),
  /** AI Patch §12.2 — 'needs_review' when the allocation is incompatible. */
  macro_target_status text not null default 'ok'
    check (macro_target_status in ('ok', 'needs_review', 'insufficient_data')),
  /** Guardrail §2.2 / AI Patch §12.1: full formula + input provenance. */
  calculation_basis jsonb,
  evidence_ref_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, effective_date)
);

create index if not exists nutrition_targets_user_date_idx
  on public.nutrition_targets(user_id, effective_date desc);

comment on table public.nutrition_targets is
  'Daily calorie target (user-set) plus derived macro recommendation with '
  'calculation_basis and evidence refs. Macro targets are a system reference, '
  'not a user-imposed limit (Product §4.1 / AC-P02).';

drop trigger if exists nutrition_targets_set_updated_at on public.nutrition_targets;
create trigger nutrition_targets_set_updated_at
  before update on public.nutrition_targets
  for each row execute function public.set_updated_at();

alter table public.nutrition_targets enable row level security;
alter table public.nutrition_targets force row level security;

drop policy if exists nutrition_targets_manage_own on public.nutrition_targets;
create policy nutrition_targets_manage_own on public.nutrition_targets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
