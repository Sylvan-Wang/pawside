# 居家轻力量上线执行清单

目标：线上执行 4 份迁移并激活两个居家方法；**不自动入组、不改现有用户的任何数据**。

## 为什么对现有用户数据安全（已在本地库验证的部分）

- `20261022000100`：给 `methods` 加一列（默认 `full_gym`，现有方法不变）；替换 `switch_method_release_v1(uuid,text)`，**有在用方法时的逻辑与原来逐行一致**，只是在「没有在用方法」时新增入组分支（原来这里直接报错）。不改、不删任何用户行。
- `20261022000200`：只新增两个方法、两个 release、动作与处方；不碰现有方法、release、用户记录。
- `20261022000300`：给 `exercises` 加两个可空列。
- `20261022000400`：只把两个居家 release 从 `validated` 改为 `active`。

## 执行前

1. **备份**：Supabase 控制台做一次手动备份（或确认 PITR 可用）。
2. 记录行数基线（执行后对比，应一致或只增不减）：

```sql
select 'enrollments' t, count(*) from method_enrollments
union all select 'sessions', count(*) from workout_sessions
union all select 'set_executions', count(*) from set_executions
union all select 'workout_logs', count(*) from workout_logs
union all select 'methods', count(*) from methods
union all select 'active_releases', count(*) from method_releases where status='active';
```

3. 确认之前的迁移已应用到 `20261007000200`：`select max(version) from supabase_migrations.schema_migrations;`
4. 确认当前没有人卡在进行中的训练里无所谓——这次不改训练流程；但建议避开使用高峰。

## 执行（按顺序，每份单独执行并检查）

1. `20261022000100_method_equipment_requirement.sql`
2. `20261022000200_home_five_session_methods.sql`
3. `20261022000300_exercise_tutorial_link.sql`
4. `20261022000400_activate_home_five_session.sql`

## 执行后核对

```sql
-- 现有方法的器械要求不变
select key, required_equipment from methods order by key;
-- 两个居家方法已激活，各 5 天
select m.key, r.status, (select count(*) from method_splits s where s.method_release_id = r.id) days
from methods m join method_releases r on r.method_id = m.id where m.key like 'home_%';
-- 现有方法没有被改动
select m.key, r.version, r.status from methods m join method_releases r on r.method_id = m.id
where m.key in ('four_split_2026','ksw_tcy_three_split_2026') order by 1,2;
-- 没有任何人被自动入组到居家方法
select count(*) from method_enrollments e join methods m on m.id = e.method_id where m.key like 'home_%';  -- 应为 0
```

再跑第 1 步的行数基线，与执行前对比。然后用一个居家账号打开「设置 → 训练方法」，应看到全部方法，不匹配的灰显。

## 回滚

- 只想下线居家方法：把两个居家 release 改回 `retired`（active release 只允许改为 retired）。已有人入组后不要删除任何行。
- 其余迁移是加列/新增，无需回滚。
