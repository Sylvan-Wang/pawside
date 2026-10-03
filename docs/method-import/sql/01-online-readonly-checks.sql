-- 方法论导入大更新 · 文档 1 配套：线上只读核对 SQL
--
-- 用法：在 Supabase SQL Editor 里一条一条运行（每条以 "-- [Vn]" 开头）。
-- 全部只读：只有 select，不含任何写入、DDL 或函数创建。
-- 不输出邮箱，只输出 user_id 前 8 位，便于回贴给我又不泄露账号。
-- 已在本地 PostgreSQL 16 + master 全部 27 个迁移回放的临时库中运行通过（语法与结果结构）。
-- 线上请把每条结果整段复制回来（JSON 或表格都行）。

-- [V1] 全库各表行数（迁移前后的总对账基线）
select table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as row_count
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;

-- [V2] 报名分布：多少用户、多少报名、各状态
select e.status,
       count(*) as enrollments,
       count(distinct e.user_id) as users,
       min(e.started_at)::date as first_started,
       max(e.started_at)::date as last_started
from public.method_enrollments e
group by e.status
order by e.status;

-- [V3] 每个用户的训练事实概览（只给 user_id 前 8 位）
select left(s.user_id::text, 8) as user_prefix,
       count(*) filter (where s.status = 'completed') as completed_sessions,
       count(*) filter (where s.status = 'started')   as open_sessions,
       min(s.log_date) as first_day,
       max(s.log_date) as last_day
from public.workout_sessions s
group by s.user_id
order by completed_sessions desc;

-- [V4] 动作级状态表是否有数据（预期为 0：迁移里没有任何写入它的代码）
select count(*) as user_exercise_progression_rows from public.user_exercise_progression;

-- [V5] 训练日志副本的来源：方法路径写入 vs 自由记录
select count(*) as total_logs,
       count(*) filter (where method_workout_session_id is not null) as written_by_method,
       count(*) filter (where method_workout_session_id is null)     as written_by_free_log
from public.workout_logs;

-- [V6] 已完成的会话里，有多少没有对应的日志副本（预期为 0）
select count(*) as completed_sessions_without_log
from public.workout_sessions s
where s.status = 'completed'
  and not exists (select 1 from public.workout_logs l where l.method_workout_session_id = s.id);

-- [V7] 日志类型分布（方法路径是 推/拉/腿，自由记录是 胸/背/腿/肩/手臂/有氧/拉伸/其他）
select type, count(*) as logs
from public.workout_logs
group by type
order by logs desc;

-- [V8a] 疑似重复的动作身份（去空格、忽略大小写后同名）
select lower(regexp_replace(canonical_name_zh, '\s+', '', 'g')) as normalized_name,
       count(*) as rows,
       array_agg(canonical_name_zh) as names
from public.exercises
group by 1
having count(*) > 1;

-- [V8b] 同一个别名指向多个动作
select a.alias, array_agg(distinct e.canonical_name_zh) as exercise_names
from public.exercises e
cross join lateral unnest(e.aliases) as a(alias)
group by a.alias
having count(distinct e.id) > 1;

-- [V9] 关键父表的外键删除规则（验证"删报名会连带删历史"等级联路径）
select conrelid::regclass::text as child_table,
       conname,
       confrelid::regclass::text as parent_table,
       case confdeltype
         when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
         when 'n' then 'SET NULL'  when 'd' then 'SET DEFAULT'
       end as on_delete
from pg_constraint
where contype = 'f'
  and confrelid in (
    'public.method_enrollments'::regclass, 'public.workout_sessions'::regclass,
    'public.session_prescriptions'::regclass, 'public.exercises'::regclass,
    'public.method_releases'::regclass, 'public.methods'::regclass
  )
order by parent_table, child_table, conname;

-- [V10] 方法、动作、训练事实相关表的行级安全策略
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and (tablename like 'method\_%' or tablename in (
        'methods', 'exercises', 'exercise_media', 'exercise_external_mappings',
        'workout_sessions', 'exercise_executions', 'set_executions',
        'session_prescriptions', 'exercise_prescriptions', 'set_prescriptions',
        'user_exercise_progression'))
order by tablename, policyname;

-- [V11] 已完成的逐组记录里，缺重量的比例（有氧、自重动作会合理缺重量，仅作参考）
select count(*) as completed_sets,
       count(*) filter (where actual_weight_kg is null) as completed_sets_without_weight
from public.set_executions
where status = 'completed';

-- [V12] 开着超过 24 小时的训练会话数
select count(*) as open_sessions_older_than_1_day
from public.workout_sessions
where status = 'started' and started_at < now() - interval '1 day';

-- [V13] 事实表快照哈希：迁移前后各跑一次，哈希必须完全一致
select 'workout_sessions' as table_name, count(*) as n,
       md5(string_agg(id::text || status || coalesce(completed_at::text, ''), ',' order by id)) as hash
from public.workout_sessions
union all
select 'exercise_executions', count(*),
       md5(string_agg(id::text || exercise_id::text || status, ',' order by id))
from public.exercise_executions
union all
select 'set_executions', count(*),
       md5(string_agg(id::text || coalesce(actual_weight_kg::text, '') || coalesce(actual_reps::text, '') || status, ',' order by id))
from public.set_executions
union all
select 'workout_logs', count(*),
       md5(string_agg(id::text || date::text || type || coalesce(duration_minutes::text, '') || exercises::text, ',' order by id))
from public.workout_logs;

-- [V14] 已执行的迁移（仅线上有 supabase_migrations 模式；本地临时库没有，运行会报错属正常）
-- select version from supabase_migrations.schema_migrations order by version desc limit 15;
