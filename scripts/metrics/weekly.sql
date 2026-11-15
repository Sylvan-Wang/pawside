-- 周指标汇总（周计划第 4 节「指标」用）。只读，只出计数，不出任何个人内容。
--
-- 用法：在 Supabase SQL 编辑器里跑，或由带数据库权限的会话只读执行。
-- 剔除测试账号：xxa 指定的 zichenwang209（2026-11-07，周计划 #30）。新增测试账号时改 test_accounts。
-- 「活跃」= 在这段时间里有过任一条记录（训练、饮食、体重、小爪消息）。登录时间只做参考，
-- 因为保持登录的人不会刷新 last_sign_in_at。
-- ai_calls_7d / ai_failures_7d 是全站小爪调用（含测试账号），用来看健康度，不算用户指标。

with test_accounts as (
  select id from auth.users where split_part(email, '@', 1) in ('zichenwang209')
),
real_users as (
  select id, created_at, last_sign_in_at from auth.users where id not in (select id from test_accounts)
),
activity as (
  select user_id, created_at, 'workout' as kind from public.workout_sessions
  union all select user_id, created_at, 'meal' from public.food_logs
  union all select user_id, created_at, 'meal' from public.user_food_logs
  union all select user_id, created_at, 'weight' from public.body_metrics
  union all select user_id, created_at, 'coach' from public.coach_messages where role = 'user'
),
real_activity as (
  select * from activity where user_id in (select id from real_users)
)
select
  (select count(*) from real_users) as real_users_total,
  (select count(*) from real_users where created_at > now() - interval '7 days') as signups_7d,
  (select count(distinct user_id) from real_activity where created_at > now() - interval '24 hours') as active_24h,
  (select count(distinct user_id) from real_activity where created_at > now() - interval '7 days') as active_7d,
  (select count(distinct user_id) from real_activity where kind = 'workout' and created_at > now() - interval '7 days') as users_with_workout_7d,
  (select count(distinct user_id) from real_activity where kind = 'meal' and created_at > now() - interval '7 days') as users_with_meal_7d,
  (select count(distinct user_id) from real_activity where kind = 'coach' and created_at > now() - interval '7 days') as users_with_coach_7d,
  (select count(*) from real_users where last_sign_in_at > now() - interval '7 days') as signed_in_7d,
  (select count(*) from public.seed_signups) as seed_signups_total,
  (select count(*) from public.seed_signups where created_at > now() - interval '7 days') as seed_signups_7d,
  (select count(*) from public.ai_generations where created_at > now() - interval '7 days') as ai_calls_7d,
  (select count(*) from public.ai_generations where created_at > now() - interval '7 days' and status = 'failed') as ai_failures_7d,
  -- 应为 1；变成 0 说明测试账号改了邮箱，上面的数字混进了测试数据。
  (select count(*) from test_accounts) as test_accounts_matched;
