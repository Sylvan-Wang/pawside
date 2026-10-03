-- 草案，不是迁移。刻意放在 docs/ 下，不在 supabase/migrations/ 中，避免被误执行。
-- 文档 2 配套：多日方法、私有方法、个人调整层所需的增量 DDL。
-- 依赖：先应用 01-draft-migrations.sql（M1–M5）。
-- 验证：2026-10-03 在本地 PostgreSQL 16 + master 全部 27 个迁移 + 01 草案的回放库中执行通过，并实测：
--   · 新的分化键可写入，格式非法的键被拒绝
--   · next_program_day 与现有写死逻辑在 1.2 的全部账本状态下结果一致
--   · workout_log_type_for_split 对 push/pull/legs 与现有 CASE 结果一致
--   · 私有方法只有创建者可见，已激活的官方方法对所有人可见
--   · 账号删除能连带清理私有方法及其训练记录
-- 线上执行前必须：用户明确同意（H8）→ 分支库演练 → 01-online-readonly-checks.sql 的 V13 前后一致。
-- 所有语句只增加结构或放宽约束，不移动、不改写、不删除任何已有数据行。

-- =====================================================================================
-- M6  分化键泛化：把"只能是 push/pull/legs"放宽为"格式合法的键"
--     步骤：加新约束(NOT VALID) → 校验 → 删旧约束。已有数据全部满足，校验不会失败。
--     共 5 处：method_splits.key、method_enrollments.next_split_key、
--     session_prescriptions.split_key、workout_sessions.split_key、method_source_chunks.split_key
-- =====================================================================================
begin;
alter table public.method_splits add constraint method_splits_key_format_check
  check (key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.method_splits validate constraint method_splits_key_format_check;
alter table public.method_splits drop constraint method_splits_key_check;

alter table public.method_enrollments add constraint method_enrollments_next_split_key_format_check
  check (next_split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.method_enrollments validate constraint method_enrollments_next_split_key_format_check;
alter table public.method_enrollments drop constraint method_enrollments_next_split_key_check;

alter table public.session_prescriptions add constraint session_prescriptions_split_key_format_check
  check (split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.session_prescriptions validate constraint session_prescriptions_split_key_format_check;
alter table public.session_prescriptions drop constraint session_prescriptions_split_key_check;

alter table public.workout_sessions add constraint workout_sessions_split_key_format_check
  check (split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.workout_sessions validate constraint workout_sessions_split_key_format_check;
alter table public.workout_sessions drop constraint workout_sessions_split_key_check;

alter table public.method_source_chunks add constraint method_source_chunks_split_key_format_check
  check (split_key is null or split_key ~ '^[a-z][a-z0-9_]{1,31}$') not valid;
alter table public.method_source_chunks validate constraint method_source_chunks_split_key_format_check;
alter table public.method_source_chunks drop constraint method_source_chunks_split_key_check;
commit;
-- 回滚：重新加回原来的三值约束后删除格式约束。注意：回滚前若已有新分化键的数据，需先处理这些行。

-- =====================================================================================
-- M7  分化日的类型与节奏
--     day_type：力量 / 核心 / 有氧。休息不作为分化日存在，由 min_gap_days 表达：
--     完成这一天之后，下一练的"最早建议开始日" = 完成日 + min_gap_days（0 = 当天即可，与现状一致）。
--     仅作建议，不阻止训练（现有代码里 planned_for_date 只被读取，没有任何拦截逻辑）。
--     is_required：是否计入"一轮完成"。已有行默认 true，行为不变。
-- =====================================================================================
begin;
alter table public.method_splits
  add column day_type text not null default 'strength'
    check (day_type in ('strength', 'core', 'cardio')),
  add column is_required boolean not null default true,
  add column min_gap_days smallint not null default 0
    check (min_gap_days between 0 and 7);

-- 跳过某个分化日（用户主动）：新增 skipped 状态，不复用 cancelled（cancelled 在现有逻辑里表示"作废"）
alter table public.session_prescriptions add constraint session_prescriptions_status_v2_check
  check (status in ('upcoming', 'ready', 'started', 'completed', 'rest_deferred', 'cancelled', 'skipped')) not valid;
alter table public.session_prescriptions validate constraint session_prescriptions_status_v2_check;
alter table public.session_prescriptions drop constraint session_prescriptions_status_check;
commit;

-- =====================================================================================
-- M8  时长型、距离型的处方目标（与 01 草案的实际记录列对应）
-- =====================================================================================
begin;
alter table public.set_prescriptions
  add column target_duration_seconds integer
    check (target_duration_seconds is null or target_duration_seconds > 0),
  add column target_distance_m numeric(9,2)
    check (target_distance_m is null or target_distance_m > 0);
alter table public.method_runtime_set_templates
  add column target_duration_seconds integer
    check (target_duration_seconds is null or target_duration_seconds > 0),
  add column target_distance_m numeric(9,2)
    check (target_distance_m is null or target_distance_m > 0);
commit;

-- =====================================================================================
-- M9  可信度标签扩展：method_rules 与 method_prescription_field_values 的 source_authority
--     新增 library_default（金标默认）、ai_inferred（AI 推断，需确认）、user_corrected（用户更正）
-- =====================================================================================
begin;
alter table public.method_rules add constraint method_rules_source_authority_v2_check
  check (source_authority in ('method_explicit', 'official_reconstructed', 'product_execution_default',
                              'unresolved', 'library_default', 'ai_inferred', 'user_corrected')) not valid;
alter table public.method_rules validate constraint method_rules_source_authority_v2_check;
alter table public.method_rules drop constraint method_rules_source_authority_check;

alter table public.method_prescription_field_values add constraint method_prescription_field_values_source_authority_v2_check
  check (source_authority in ('method_explicit', 'official_reconstructed', 'product_execution_default',
                              'unresolved', 'library_default', 'ai_inferred', 'user_corrected')) not valid;
alter table public.method_prescription_field_values validate constraint method_prescription_field_values_source_authority_v2_check;
alter table public.method_prescription_field_values drop constraint method_prescription_field_values_source_authority_check;
commit;

-- =====================================================================================
-- M10  轮转与日志类型：把写死的 VALUES ('push',1),('pull',2),('legs',3) 与
--      CASE split_key when 'push' then '推' … else '腿' 换成读方法数据的函数。
--      旧函数不改；新版本的完成训练函数调用这两个函数（见文档 2 第 6 节）。
-- =====================================================================================
begin;
create function public.next_program_day(p_cycle_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select split.key
  from public.method_cycles cycle
  join public.method_enrollments enrollment on enrollment.id = cycle.enrollment_id
  join public.method_splits split on split.method_release_id = enrollment.method_release_id
  where cycle.id = p_cycle_id
    and split.is_required
    and not exists (
      select 1 from public.session_prescriptions prescription
      where prescription.cycle_id = cycle.id
        and prescription.split_key = split.key
        and prescription.status in ('completed', 'skipped')
    )
  order by split.order_index
  limit 1
$$;
revoke all on function public.next_program_day(uuid) from public, anon;

create function public.workout_log_type_for_split(p_enrollment_id uuid, p_split_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select split.name_zh
  from public.method_enrollments enrollment
  join public.method_splits split on split.method_release_id = enrollment.method_release_id
  where enrollment.id = p_enrollment_id and split.key = p_split_key
$$;
revoke all on function public.workout_log_type_for_split(uuid, text) from public, anon;
commit;

-- =====================================================================================
-- M11  私有方法：归属与可见性
--      methods 新增 owner_user_id（空 = 官方共享）与 hidden_at（仅从"我的方法库"列表隐藏，不影响读取）。
--      原先 methods 是"人人可读"，各 release 级表是"已激活即人人可读"，都要加上归属条件，
--      否则私有方法会泄露给所有登录用户。
-- =====================================================================================
begin;
alter table public.methods
  add column owner_user_id uuid references auth.users(id) on delete cascade,
  add column hidden_at timestamptz;

create function public.method_visible_to_user(p_method_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.methods m
    where m.id = p_method_id
      and (m.owner_user_id is null or m.owner_user_id = (select auth.uid()))
  )
$$;
revoke all on function public.method_visible_to_user(uuid) from public, anon;
grant execute on function public.method_visible_to_user(uuid) to authenticated;

drop policy methods_authenticated_read on public.methods;
create policy methods_read_shared_or_own on public.methods for select to authenticated
  using (owner_user_id is null or owner_user_id = (select auth.uid()));

drop policy method_releases_authenticated_read_active on public.method_releases;
create policy method_releases_read_active_visible on public.method_releases for select to authenticated
  using (status = 'active' and public.method_visible_to_user(method_id));

drop policy method_splits_authenticated_read_active on public.method_splits;
create policy method_splits_read_active_visible on public.method_splits for select to authenticated
  using (exists (
    select 1 from public.method_releases rel
    where rel.id = method_splits.method_release_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));

drop policy method_rules_authenticated_read_active on public.method_rules;
create policy method_rules_read_active_visible on public.method_rules for select to authenticated
  using (exists (
    select 1 from public.method_releases rel
    where rel.id = method_rules.method_release_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));

drop policy method_split_exercises_authenticated_read_active on public.method_split_exercises;
create policy method_split_exercises_read_active_visible on public.method_split_exercises for select to authenticated
  using (exists (
    select 1 from public.method_splits ms
    join public.method_releases rel on rel.id = ms.method_release_id
    where ms.id = method_split_exercises.method_split_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));

drop policy method_prescription_fields_authenticated_read_active on public.method_prescription_field_values;
create policy method_prescription_fields_read_active_visible on public.method_prescription_field_values for select to authenticated
  using (exists (
    select 1 from public.method_split_exercises mse
    join public.method_splits ms on ms.id = mse.method_split_id
    join public.method_releases rel on rel.id = ms.method_release_id
    where mse.id = method_prescription_field_values.method_split_exercise_id
      and rel.status = 'active' and public.method_visible_to_user(rel.method_id)));
commit;
-- 回滚：恢复各表原策略后，drop 新策略、函数和两列。

-- =====================================================================================
-- M12  个人调整层：激活后的 release 不可变，用户的个性化（隐藏、替换、改组次、跳过某天）放这里。
--      写入只能经由函数，用户对自己的调整只有读权限。
-- =====================================================================================
begin;
create table public.user_method_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.method_enrollments(id) on delete restrict,
  split_key text not null check (split_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  exercise_id uuid references public.exercises(id) on delete restrict,
  action text not null check (action in ('hide_exercise', 'swap_exercise', 'set_count', 'rep_range', 'skip_day')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (action = 'skip_day' or exercise_id is not null)
);
create index user_method_adjustments_enrollment_idx
  on public.user_method_adjustments(enrollment_id, split_key) where revoked_at is null;
alter table public.user_method_adjustments enable row level security;
alter table public.user_method_adjustments force row level security;
revoke all on table public.user_method_adjustments from anon, authenticated;
grant select on table public.user_method_adjustments to authenticated;
create policy user_method_adjustments_select_own on public.user_method_adjustments
  for select to authenticated using (user_id = (select auth.uid()));
commit;

-- =====================================================================================
-- M13  允许"账号删除"级联清理私有方法
--      实测：现有触发器禁止删除任何 active release 及其分化日、规则，包括由 methods 级联而来的删除，
--      因此如果私有方法归属用户并设为级联，账号删除会失败（先后卡在 method_splits、method_releases 两处）。
--      修复：只放行"所属方法行已经不存在"（即级联）的删除；直接删除 active release 或其内容仍然阻止。
--      其余分支与原函数完全一致。
-- =====================================================================================
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
  -- 级联放行：所属方法已被删除（账号删除清理私有方法）
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
-- 回滚：恢复两个原函数（20260909000200_method_release_governance.sql 中的同名函数）。
