-- 草案，不是迁移。刻意放在 docs/ 下，不在 supabase/migrations/ 中，避免被误执行。
-- 文档 3 配套：金标动作库、导入记录与配额、动作对齐函数。
-- 依赖：先应用 01-draft-migrations.sql、02-draft-migrations.sql。
-- 验证：2026-10-03 在本地 PostgreSQL 16 + master 全部 27 个迁移 + 01 + 02 草案的回放库中执行通过，
--       并实测了：精确/别名命中已审核动作、新名称创建草稿且同一用户重复调用返回同一条、
--       他人同名草稿不被复用（创建带后缀的新草稿）、草稿的可见性、导入配额触发器、
--       没有同意记录就无法创建导入、客户端不能把导入状态改成 published。
-- 线上执行前必须：用户明确同意（H8）→ 分支库演练。
-- 所有语句只增加结构，不移动、不改写、不删除任何已有数据行。

-- =====================================================================================
-- M14  金标动作库：风险标记、默认值、替换关系、要点
--      "动作身份"沿用现有 exercises 表（文档 1 的 M1 已加 review_status / record_shape）。
--      这三张表是参考数据：所有登录用户可读（草稿与已审核都可读，用 review_status 区分可信度），
--      客户端没有任何写权限，写入只来自受控的种子迁移。
-- =====================================================================================
begin;
alter table public.exercises
  add column risk_flags text[] not null default '{}';
comment on column public.exercises.risk_flags is
  '例如 beginner_risk、failure_risk、spine_load。仅用于导入时的提示，不用于拦截训练。';

create table public.exercise_defaults (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  sets_min smallint check (sets_min is null or sets_min between 1 and 12),
  sets_max smallint check (sets_max is null or sets_max between 1 and 12),
  reps_min smallint check (reps_min is null or reps_min between 1 and 100),
  reps_max smallint check (reps_max is null or reps_max between 1 and 100),
  rest_seconds_min integer check (rest_seconds_min is null or rest_seconds_min between 0 and 600),
  rest_seconds_max integer check (rest_seconds_max is null or rest_seconds_max between 0 and 600),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 7200),
  distance_m numeric(9,2) check (distance_m is null or distance_m > 0),
  failure_policy text not null default 'avoid' check (failure_policy in ('avoid', 'allowed', 'required')),
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed')),
  source_note text,
  created_at timestamptz not null default now(),
  unique (exercise_id, level),
  check (sets_min is null or sets_max is null or sets_min <= sets_max),
  check (reps_min is null or reps_max is null or reps_min <= reps_max),
  check (rest_seconds_min is null or rest_seconds_max is null or rest_seconds_min <= rest_seconds_max)
);

create table public.exercise_substitutions (
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  substitute_exercise_id uuid not null references public.exercises(id) on delete restrict,
  kind text not null check (kind in ('swap', 'regression', 'progression')),
  note text,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed')),
  primary key (exercise_id, substitute_exercise_id, kind),
  check (exercise_id <> substitute_exercise_id)
);

create table public.exercise_cues (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  kind text not null check (kind in ('setup', 'execution', 'breathing', 'common_mistake', 'safety')),
  text_zh text not null check (length(text_zh) between 1 and 200),
  sort_order smallint not null default 0,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed'))
);
create index exercise_cues_exercise_idx on public.exercise_cues(exercise_id, sort_order);

alter table public.exercise_defaults enable row level security;
alter table public.exercise_substitutions enable row level security;
alter table public.exercise_cues enable row level security;
revoke all on table public.exercise_defaults, public.exercise_substitutions, public.exercise_cues from anon, authenticated;
grant select on table public.exercise_defaults, public.exercise_substitutions, public.exercise_cues to authenticated;
create policy exercise_defaults_authenticated_read on public.exercise_defaults for select to authenticated using (true);
create policy exercise_substitutions_authenticated_read on public.exercise_substitutions for select to authenticated using (true);
create policy exercise_cues_authenticated_read on public.exercise_cues for select to authenticated using (true);
commit;

-- =====================================================================================
-- M15  导入记录：原文、草稿 manifest、同意记录、配额
--      没有同意（consent_version / consented_at 为非空约束）就无法创建导入，这在数据库层面保证
--      "勾选健康声明后才能继续"。
--      配额：同一用户 24 小时内最多创建 5 条导入（数值是建议，见文档 5）。
-- =====================================================================================
begin;
create table public.user_method_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'extracting', 'review', 'published', 'failed', 'discarded')),
  raw_text text check (raw_text is null or length(raw_text) <= 30000),
  text_checksum_sha256 text not null check (text_checksum_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_draft jsonb check (manifest_draft is null or jsonb_typeof(manifest_draft) = 'object'),
  open_questions_count integer not null default 0 check (open_questions_count >= 0),
  consent_version text not null check (length(consent_version) between 1 and 40),
  consented_at timestamptz not null,
  published_method_id uuid references public.methods(id) on delete set null,
  failure_reason text,
  raw_text_purge_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_method_imports_user_idx on public.user_method_imports(user_id, created_at desc);

create function public.enforce_import_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.user_method_imports i
       where i.user_id = new.user_id and i.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Import limit reached (5 per 24 hours)' using errcode = '54000';
  end if;
  return new;
end
$$;
create trigger user_method_imports_quota before insert on public.user_method_imports
  for each row execute function public.enforce_import_quota();
revoke all on function public.enforce_import_quota() from public, anon, authenticated;

alter table public.user_method_imports enable row level security;
alter table public.user_method_imports force row level security;
revoke all on table public.user_method_imports from anon, authenticated;
grant select, insert, update on table public.user_method_imports to authenticated;
create policy user_method_imports_select_own on public.user_method_imports
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_method_imports_insert_own on public.user_method_imports
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'draft');
create policy user_method_imports_update_own on public.user_method_imports
  for update to authenticated
  using (user_id = (select auth.uid()) and status in ('draft', 'extracting', 'review', 'failed'))
  with check (user_id = (select auth.uid()) and status in ('draft', 'extracting', 'review', 'failed', 'discarded'));
-- 客户端不能把导入改成 published：该状态只由发布函数（create_private_method_v1，security definer）写入。
commit;

-- =====================================================================================
-- M16  动作对齐：名称 → 动作身份
--      优先级：已审核动作（名称或别名，去空格/标点、忽略大小写）> 本人草稿 > 新建本人草稿。
--      他人的草稿不会被复用（避免互相污染，也不暴露其存在）；同名冲突时创建带后缀的新草稿。
--      每人最多 100 个草稿动作。
-- =====================================================================================
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

-- =====================================================================================
-- M17  来源类型：允许登记"用户粘贴文本"（只登记校验和，不存原文；原文在 user_method_imports）
-- =====================================================================================
begin;
alter table public.method_source_documents add constraint method_source_documents_source_type_v2_check
  check (source_type in ('transcript', 'official_video', 'prd', 'spec', 'workbook', 'product_patch', 'user_text')) not valid;
alter table public.method_source_documents validate constraint method_source_documents_source_type_v2_check;
alter table public.method_source_documents drop constraint method_source_documents_source_type_check;
commit;

-- =====================================================================================
-- 依赖 Patch B（T3，PR #3）合并后再做，不在本草案内执行：
--   ai_generations.surface 的检查约束目前只允许 6 个值，需要加入 'method_import'，
--   这样每一次抽取调用（成功与失败）都会进入同一张生成日志。
-- =====================================================================================
