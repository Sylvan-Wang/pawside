-- 草案，不是迁移。刻意放在 docs/ 下，不在 supabase/migrations/ 中，避免被误执行。
-- 文档 1 配套：数据脱钩所需的全部增量 DDL。
-- 验证：2026-10-03 在本地 PostgreSQL 16 + master 全部 27 个迁移回放的临时库中执行通过，
--       并实测了：时长型记录可写入、无任何度量的"已完成"组仍被拒绝、历史视图、软删除隐藏、
--       别名重定向、草稿动作的行级安全（创建者可见，他人不可见，已审核动作仍对所有人可见）。
-- 线上执行前必须：用户明确同意（H8）→ 先跑 01-online-readonly-checks.sql 的 V1、V13 留基线 →
--                 执行 → 再跑一次，事实表哈希必须一致。
-- 所有语句只增加结构，不移动、不改写、不删除任何已有数据行。

-- =====================================================================================
-- M5  防止误删有训练记录的报名（先上，风险最低）
--     实测：不加这个触发器时，删除一个报名会把该报名下的全部训练记录一并删掉。
--     账号删除（auth.users 级联）仍然允许：此时 auth.users 行已不存在。
-- =====================================================================================
begin;
create or replace function public.guard_enrollment_delete_with_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.workout_sessions s where s.enrollment_id = old.id)
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'Enrollment % has training history; archive it instead of deleting', old.id
      using errcode = '23503';
  end if;
  return old;
end
$$;

create trigger method_enrollments_guard_delete
  before delete on public.method_enrollments
  for each row execute function public.guard_enrollment_delete_with_history();
-- Supabase 默认给 anon/authenticated 授予新函数的执行权限；触发器函数不需要这些权限。
revoke all on function public.guard_enrollment_delete_with_history() from public, anon, authenticated;
commit;
-- 回滚：drop trigger method_enrollments_guard_delete on public.method_enrollments;
--       drop function public.guard_enrollment_delete_with_history();

-- =====================================================================================
-- M1  动作身份治理：审核状态、创建者、记录形态、别名重定向
-- =====================================================================================
begin;
alter table public.exercises
  add column review_status text not null default 'reviewed'
    check (review_status in ('draft', 'reviewed')),
  add column created_by uuid references auth.users(id) on delete set null,
  add column record_shape text not null default 'weight_reps'
    check (record_shape in ('weight_reps', 'bodyweight_reps', 'duration', 'distance_duration', 'assisted_bodyweight'));

-- 已有行全部落为 reviewed / weight_reps，行为与现在完全一致。
-- 用新策略替换"人人可读"：已审核的对所有人可读，草稿只有创建者可读。
drop policy exercises_authenticated_read on public.exercises;
create policy exercises_read_reviewed_or_own on public.exercises
  for select to authenticated
  using (review_status = 'reviewed' or created_by = (select auth.uid()));

create table public.exercise_redirects (
  from_exercise_id uuid primary key references public.exercises(id) on delete restrict,
  to_exercise_id uuid not null references public.exercises(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  check (from_exercise_id <> to_exercise_id)
);
alter table public.exercise_redirects enable row level security;
revoke all on table public.exercise_redirects from anon, authenticated;
grant select on table public.exercise_redirects to authenticated;
create policy exercise_redirects_authenticated_read on public.exercise_redirects
  for select to authenticated using (true);

create function public.canonical_exercise_id(p_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  cur uuid := p_id;
  nxt uuid;
  depth int := 0;
begin
  loop
    select r.to_exercise_id into nxt from public.exercise_redirects r where r.from_exercise_id = cur;
    exit when nxt is null;
    cur := nxt;
    depth := depth + 1;
    if depth > 8 then
      raise exception 'exercise redirect chain too deep for %', p_id;
    end if;
  end loop;
  return cur;
end
$$;
revoke all on function public.canonical_exercise_id(uuid) from public, anon;
grant execute on function public.canonical_exercise_id(uuid) to authenticated;
commit;
-- 回滚：恢复 exercises_authenticated_read（using (true)）后 drop 新策略、新表、新函数、新列。

-- =====================================================================================
-- M3  记录形态：时长、距离；放宽"已完成的组必须有次数"
--     这是唯一必须放松的既有约束。步骤：加新约束(NOT VALID) → 校验 → 删旧约束。
--     已有数据全部满足新约束（有次数），所以校验不会失败。
-- =====================================================================================
begin;
alter table public.set_executions
  add column actual_duration_seconds integer
    check (actual_duration_seconds is null or actual_duration_seconds >= 0),
  add column actual_distance_m numeric(9,2)
    check (actual_distance_m is null or actual_distance_m >= 0);

alter table public.set_executions add constraint set_executions_completed_has_measure check (
  (status = 'completed' and completed_at is not null
     and (actual_reps is not null or actual_duration_seconds is not null or actual_distance_m is not null))
  or status <> 'completed'
) not valid;
alter table public.set_executions validate constraint set_executions_completed_has_measure;
alter table public.set_executions drop constraint set_executions_check;
commit;
-- 回滚：重新加回原约束（completed 必须 actual_reps 非空）后删除新约束与新列。
--       注意：回滚前若已有时长型记录写入，需先处理这些行，否则无法加回原约束。

-- =====================================================================================
-- M4  软删除：用户删除一次训练时只隐藏，不物理删除（决策 D-10，待确认）
-- =====================================================================================
begin;
alter table public.workout_sessions add column deleted_at timestamptz;
commit;
-- 所有读取 workout_sessions 的地方必须加 deleted_at is null，清单见文档 1 第 6 节。

-- =====================================================================================
-- M2  动作级历史视图（只读，无新写路径）。依赖 M1、M3、M4。
-- =====================================================================================
begin;
create view public.v_user_exercise_sets with (security_invoker = true) as
select se.user_id,
       public.canonical_exercise_id(ee.exercise_id) as exercise_id,
       ee.exercise_id as recorded_exercise_id,
       ws.id as workout_session_id,
       coalesce(ws.performed_at, ws.completed_at, ws.started_at) as performed_at,
       ws.log_date,
       se.set_index,
       se.actual_weight_kg,
       se.actual_reps,
       se.actual_rir,
       se.actual_duration_seconds,
       se.actual_distance_m,
       se.is_extra
from public.set_executions se
join public.exercise_executions ee on ee.id = se.exercise_execution_id
join public.workout_sessions ws on ws.id = se.workout_session_id
where ws.status = 'completed' and ws.deleted_at is null and se.status = 'completed';
grant select on public.v_user_exercise_sets to authenticated;

create view public.v_user_exercise_last_top with (security_invoker = true) as
with latest as (
  select distinct on (user_id, exercise_id) user_id, exercise_id, workout_session_id, performed_at
  from public.v_user_exercise_sets
  order by user_id, exercise_id, performed_at desc
)
select l.user_id, l.exercise_id, l.workout_session_id, l.performed_at,
       (select max(v.actual_weight_kg)
          from public.v_user_exercise_sets v
         where v.user_id = l.user_id
           and v.exercise_id = l.exercise_id
           and v.workout_session_id = l.workout_session_id) as top_weight_kg
from latest l;
grant select on public.v_user_exercise_last_top to authenticated;
commit;
-- 回滚：drop view public.v_user_exercise_last_top; drop view public.v_user_exercise_sets;
