-- 新手第一周留存（周计划 #84 周三产品任务；当前重点 4「新手第一周能练下去」）。只读，只出计数。
--
-- 用法：在 Supabase SQL 编辑器里跑，或由带数据库权限的会话只读执行。
-- 剔除测试账号：zichenwang209（同 weekly.sql）。
-- 「第 N 天」按北京时间算：注册当天是第 0 天，第 1–7 天是注册后的一周。
-- 「有记录」= 当天有任一条训练、饮食、体重或小爪消息（口径同 weekly.sql 的「活跃」）。
-- 只统计注册满 8 天的人（cohort_size），否则第 7 天还没到，比例会偏低。

with test_accounts as (
  select id from auth.users where split_part(email, '@', 1) in ('zichenwang209')
),
cohort as (
  select id, (created_at at time zone 'Asia/Shanghai')::date as signup_day
  from auth.users
  where id not in (select id from test_accounts)
    and created_at < now() - interval '8 days'
),
activity as (
  select user_id, created_at, 'workout' as kind from public.workout_sessions
  union all select user_id, created_at, 'meal' from public.food_logs
  union all select user_id, created_at, 'meal' from public.user_food_logs
  union all select user_id, created_at, 'weight' from public.body_metrics
  union all select user_id, created_at, 'coach' from public.coach_messages where role = 'user'
),
by_day as (
  select distinct a.user_id, a.kind,
    (a.created_at at time zone 'Asia/Shanghai')::date - c.signup_day as day_n
  from activity a join cohort c on c.id = a.user_id
),
days as (select generate_series(0, 7) as day_n)
select
  d.day_n,
  (select count(*) from cohort) as cohort_size,
  count(distinct b.user_id) as users_with_any_record,
  count(distinct b.user_id) filter (where b.kind = 'workout') as users_with_workout,
  count(distinct b.user_id) filter (where b.kind = 'meal') as users_with_meal
from days d
left join by_day b on b.day_n = d.day_n
group by d.day_n
order by d.day_n;
