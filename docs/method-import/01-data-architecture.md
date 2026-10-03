# 方法论导入大更新 · 文档 1：数据架构与脱钩方案

- 状态：草案 v0.1
- 日期：2026-10-03
- 前置：文档 0（总纲）。本文落实原则 P2（事实归用户和动作）、P6（增量优先）和硬约束 H1–H10。
- 配套文件：
  - `sql/01-online-readonly-checks.sql`：线上只读核对 SQL（你来运行）
  - `sql/01-draft-migrations.sql`：增量 DDL 草案（不是迁移，未执行）

## 0. 关卡记录（G1–G4）

**G1 检索**：读取了运行时表定义（`20260911000200`）、基础表（`20260904000200`）、可靠性与状态迁移（`20260924000100`、`20260925000100/200/500`）、安全策略（`20260909000400`）、完成训练 RPC、`lib/coach/workout-context.ts`、导出与历史页。并在本地 PostgreSQL 16 中回放 master 全部 27 个迁移做了实测。

**G2 审核**

| 类别 | 内容 |
|---|---|
| 已核实（读到代码） | 各表字段、外键、行级安全；完成训练时写入 `workout_logs` 副本；`user_exercise_progression` 在所有迁移中没有任何写入语句，仅 `api/method/current/progress` 读取 |
| 已实测（本地回放） | 删除报名会级联清空训练记录；删除周期、处方单独被阻止；删除被报名固定的 release 被阻止；账号删除会级联；本文所有草案 DDL 可执行，且前后事实表哈希一致 |
| 推断 | 线上库与本地回放一致（线上迁移历史需用 V14 核对） |
| 未核实 | 线上的真实数据量、是否存在重复动作、`workout_logs` 与会话的对应关系（用核对 SQL 取证） |

**G3 影响面**：见文档 0 附录 A，本文新增的影响项在第 8 节。
**G4 冲突**：Patch B 的 B5 迁移（`20260926000800`）重定义了完成函数。本文的 DDL 不改任何函数，只新增结构，不与其冲突；但第 6 节的读取方清单需在 Patch B 合并后复核。

## 1. 目标与"脱钩"的精确含义

**不变量（任何阶段都必须成立）**
- **I1** 用户的每一条训练事实（某天某动作每组的数据），在整个更新过程中不丢失、不被改写。
- **I2** 换方法、归档方法、改版本、隐藏私有方法，都不会让事实消失。
- **I3** 同一个动作的历史，跨方法可见、可延续。
- **I4** 用户主动删除一次训练，才允许该次事实从视图中消失，且只做"软删除"，数据本身保留。

**脱钩不等于重做**：事实表本身（`workout_sessions → exercise_executions → set_executions`）已经带 `exercise_id` 和 `user_id`，事实是"按动作"记录的。需要解开的是事实周围的几处耦合，见第 3 节。

## 2. 现状：数据分层

```
L0 身份（共享）     auth.users、exercises（含 aliases、canonical_name_en）、
                    exercise_media、exercise_external_mappings
L1 方法（共享）     methods、method_releases、method_splits、method_rules、
                    method_split_exercises、method_prescription_field_values、
                    method_runtime_set_templates
L2 用户与方法的关系  method_enrollments → method_cycles → session_prescriptions
                    → exercise_prescriptions → set_prescriptions
                    user_exercise_progression（从未被写入）
L3 训练事实         workout_sessions → exercise_executions → set_executions
                    （另有 method_actual_change_events）
L4 副本与投影       workout_logs（已标注 deprecated；按动作名存 JSON；
                    首页、历史、周报、复盘都读它）
```

**访问控制（已核实）**：L3 的三张表对登录用户只有 `select`（行级安全限定本人），所有写入都经由 `security definer` 的函数。所以事实无法被客户端直接改写或删除，风险只来自管理员 SQL、迁移，以及将来新功能的实现方式。

## 3. 耦合点清单

| 编号 | 耦合点 | 证据 | 严重度 |
|---|---|---|---|
| C1 | 事实挂在报名之下并级联删除 | `workout_sessions.enrollment_id … on delete cascade`；**实测**：删除一个报名，会话 1→0、逐组 1→0、处方 1→0 | 高 |
| C2 | 事实必须依附于一份处方和一个固定分化键 | `session_prescription_id not null unique`；`workout_sessions.split_key check in ('push','pull','legs')` | 中 |
| C3 | 动作级状态锁在报名里，且从未写入 | `user_exercise_progression unique(enrollment_id, exercise_id)`；迁移中无 insert/update | 中 |
| C4 | 日志副本按"动作名字符串"存，类型映射有误标风险 | `workout_logs.exercises` JSON；`case … else '腿'`（`20260925000500:469-474`） | 高 |
| C5 | 历史页删除只删日志副本，不删事实 | 历史页 `delete().eq('id', id)`；`workout_logs → workout_sessions` 为 `SET NULL` | 中 |
| C6 | 导出不含逐组事实 | `api/export/route.ts:10` 训练数据只取 `workout_logs` | 中 |
| C7 | 动作身份缺少治理：名称唯一，但没有记录形态、审核状态、合并重定向 | `exercises` 列定义；别名只是文本数组 | 高 |
| C8 | 浏览器离线队列保存待提交的逐组数据 | `lib/training-offline-queue.ts` 的 `localStorage` | 低（约束 H10） |

**外键删除规则实测摘要**（本地回放）
- `workout_sessions → method_enrollments`：**CASCADE**
- `session_prescriptions → method_enrollments`：**CASCADE**
- `user_exercise_progression → method_enrollments`：**CASCADE**
- `exercise_executions / set_executions → workout_sessions`：CASCADE（随会话）
- `method_cycles → workout_sessions`（三个列）：NO ACTION
- `workout_logs → workout_sessions`：SET NULL
- 删除周期、删除处方（有会话引用时）、删除被报名固定的 release：均被阻止。

## 4. 目标模型

全部为**增量**，对应 `sql/01-draft-migrations.sql`。

### 4.1 防误删（M5）
对 `method_enrollments` 加删除前触发器：该报名名下有训练会话，且用户仍存在，就拒绝删除；账号删除不受影响。已实测三种情形：有历史的报名被阻止；账号删除仍级联；无历史的报名可删。

### 4.2 动作身份治理（M1）
- `exercises` 新增三列：
  - `review_status`（`draft` / `reviewed`，已有行默认 `reviewed`）
  - `created_by`（草稿的创建者）
  - `record_shape`（`weight_reps` / `bodyweight_reps` / `duration` / `distance_duration` / `assisted_bodyweight`，与 workout-guide 的 `exerciseType` 一一对应）
- 读取策略由"人人可读"改为：已审核的对所有人可读，草稿只有创建者可读。已实测。
- 新增 `exercise_redirects(from → to)` 与函数 `canonical_exercise_id()`：动作合并只写重定向，不改已被训练记录引用的动作 ID（H6）。链最深 8 层，超出报错。
- **不改** `canonical_name_zh` 的唯一约束（H7）。名称就是身份，两个用户导入同名动作应落到同一个身份上。
- **草稿名称冲突**：他人的草稿对你不可见，直接插入同名会撞唯一约束并暴露其存在。因此创建动作一律走一个 `security definer` 的函数（`resolve_or_create_exercise`，在文档 3 定义）：命中已审核动作就复用；命中他人草稿就创建带后缀的新草稿。

### 4.3 记录形态（M3）
- `set_executions` 新增可空的 `actual_duration_seconds`、`actual_distance_m`。
- **唯一必须放松的既有约束**：原来要求"已完成的组必须有次数"，改为"必须有次数、时长、距离之一，并且有完成时间"。步骤是先加新约束（`NOT VALID`）、再校验、再删旧约束。已有数据全部满足，已实测：仅时长的组可写入，没有任何度量的"已完成"组仍被拒绝。
- 记录形态由**动作**决定，不由日类型决定。有氧日、腹肌日不需要专门的日类型记录机制。

### 4.4 软删除（M4，决策 D-10，待确认）
- `workout_sessions` 新增 `deleted_at`。用户在历史里删除一次方法训练，就写入这个时间，不物理删除。
- 理由：若只删日志副本，被删除的训练会重新出现在"动作历史"里，违背用户预期。
- **已知限制**：软删除不回退"这一天已完成"的方法进度。这是文档 2 的产品问题（O-9）。

### 4.5 动作级历史：先用视图，不建新表（M2）
- `v_user_exercise_sets`：按用户、按（规范化后的）动作输出每组数据，已排除未完成和已软删除。
- `v_user_exercise_last_top`：每个动作最近一次训练里的最大重量。
- 两个视图都是 `security_invoker`，沿用底层表的行级安全，没有新的写路径，风险最低。
- **刻意不建 `user_exercise_state` 表**：现有的 `user_exercise_progression` 从未被写入，没有任何"要迁移的数据"；先用视图满足 B9 的"最近一次"和后续的起始重量建议，性能不足时再引入物化表。
- **规模实测**（本地 PostgreSQL 16，合成数据：2000 个用户、12394 次训练、80561 个动作执行、322244 组，其中一个重度用户有 400 次训练、约 1 万组；行级安全开启，热缓存，无并发）：

  | 查询 | 重度用户 | 普通用户（6 次训练） |
  |---|---|---|
  | `v_user_exercise_last_top`（全部动作） | 约 89 ms | 约 5 ms |
  | `v_user_exercise_sets`（单个动作的全部历史） | 约 79 ms | — |
  | `v_user_exercise_last_top` 加单个动作过滤 | 约 104 ms | — |
  | 专用查询：某动作最近一次的最大重量（`order by … limit 1`） | **约 8 ms** | — |

  结论：现有索引已够用，不需要为这两个视图新增索引。**不要**加 `set_executions(user_id)`：实测会让重度用户的视图查询从约 90 ms 变慢到约 160 ms（规划器选了低效的位图组合）。`exercise_executions(user_id, exercise_id)` 能把"视图加单动作过滤"从约 104 ms 降到约 26 ms，但专用查询本来只要 8 ms，所以只在确实需要走视图过滤的热点路径时才考虑，且要权衡对写入最频繁的表增加索引的代价。**B9 这类"取上次"请使用专用查询（下方），不要用带过滤的视图。**

  ```sql
  select ee.workout_session_id, max(se.actual_weight_kg) as top_weight
  from public.exercise_executions ee
  join public.workout_sessions ws on ws.id = ee.workout_session_id
       and ws.status = 'completed' and ws.deleted_at is null
  join public.set_executions se on se.exercise_execution_id = ee.id and se.status = 'completed'
  where ee.user_id = $1 and ee.exercise_id = $2
  group by ee.workout_session_id, ws.started_at
  order by ws.started_at desc
  limit 1;
  ```
  局限：合成数据、单机、无并发；线上数据分布不同，上线前在分支库用真实量级复测。

### 4.6 `workout_logs` 的定位（决策 D-11）
- **继续双写，作为兼容投影**；首页、历史列表、周报、复盘仍读它，直到这些页面逐个切换到事实表。
- 它不再被当作事实来源。唯一例外是**自由记录**（`method_workout_session_id` 为空的行）：它们没有逐组形式，日志本身就是事实。
- 自由记录里的动作只有名称，没有 ID。统一历史可以用名称和别名做只读匹配，匹配不上的保持未知，不猜。
- 类型映射的误标问题在文档 2 修复。

### 4.7 归档语义
- 换方法 = 在一个函数里把旧报名置为 `archived`、新建新报名。`status` 取值已含 `archived`，无需改表。
- 用户删除私有方法 = 隐藏（文档 2 新增 `hidden_at`），不物理删除；如有训练事实引用，物理删除一律不允许。

## 5. 迁移计划

| 步骤 | 内容 | 风险 | 需用户同意（H8） |
|---|---|---|---|
| M5 | 防误删触发器 | 最低，只增加一个检查 | 是 |
| M1 | 动作身份列、重定向表、策略替换 | 低；策略替换需在同一事务内完成 | 是 |
| M3 | 记录形态列与约束放松 | 低；用 `NOT VALID` 流程 | 是 |
| M4 | `deleted_at` 列 | 低，但**所有读取方必须同步加过滤**，见第 6 节 | 是 |
| M2 | 两个视图 | 最低 | 是 |

**执行与验证流程**
1. 你运行核对 SQL 的 V1、V13，保存基线。
2. 在 Supabase 的分支库（或预发布库）上演练全部草案，重跑 V13。
3. 事实表哈希必须逐表一致，V1 行数除新增表外一致。
4. 通过后，经你明确同意再推线上；推完再跑一次 V13。
5. 回滚方案见 SQL 草案每一段的注释。

**本地已验证的范围**：空库回放加一份极小数据（1 个会话）。它验证的是机制和结构，不代表线上数据量下的耗时，所以必须先在分支库演练。

## 6. M4 的读取方清单（上线前逐项核对）

读取 `workout_sessions` 的位置（本分支扫描，Patch B 合并后需复核）：
- `app/api/training/today/route.ts:127`
- `app/api/training/sessions/[sessionId]/route.ts:61`
- `lib/coach/workout-context.ts`（Patch B 链，`loadLastTime` 及会话读取）
- `app/api/workout/session-feedback/route.ts`（Patch B 链新增，读取 `workout_sessions`、`set_executions`；最终复扫时补入）
- 各 RPC：开始训练、完成训练、更新时长、保存逐组（读取会话以校验归属和状态）
- 新视图 `v_user_exercise_sets`（已含过滤）

任何遗漏都会让"已删除的训练"重新出现，所以这一项要写进验收（文档 6）。

## 7. 数据可携带性（导出）

- 新增导出项：`v_user_exercise_sets`（逐组）。属于只增不改，改动在 `app/api/export/route.ts`。
- 导出内容按"用户数据"口径，不含方法共享数据。

## 8. 对影响面台账的补充（并入文档 0 附录 A）

| 模块 | 新增影响 |
|---|---|
| 动作选择与展示（`exercises` 读取） | 读取策略变化：草稿只对创建者可见。所有按 `exercise_id` 关联并显示动作名的页面，对创建者行为不变，对他人不会出现草稿 |
| 历史页删除 | 行为定义变化：方法写入的日志被删除时，同时软删除对应会话（D-10，待确认） |
| 导出 | 新增逐组数据 |
| 账号删除 | 流程不变，已实测仍级联；需纳入验收 |

## 9. 待决事项

| 编号 | 问题 | 本文默认 |
|---|---|---|
| D-10 | 历史里删除一次训练是软删除事实还是仅删投影 | 软删除事实（待确认） |
| D-11 | `workout_logs` 是否继续双写 | 继续，待读取方全部切换后再评估 |
| O-9 | 软删除后"这一天是否可重做" | 默认不回退进度，文档 2 讨论 |
| O-10 | `method_actual_change_events`（`20260924000100`）：记录每次逐组保存/更新的前后快照，随会话和逐组级联删除 | 已核实；本更新不改动它，软删除不影响它；是否纳入导出待定 |

## 10. 本文的验收标准

- 核对 SQL 的 V1–V13 在线上运行完成并存档。
- 草案 DDL 在分支库演练通过，V13 哈希一致。
- 防误删触发器、草稿动作的可见性、软删除过滤、时长型记录，各有一条自动化测试（文档 6）。
