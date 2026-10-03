# 方法论导入大更新 · 文档 0：总纲与原则

- 状态：草案 v0.2（文档 1–7 与最终复扫已完成；决策汇总见 README）
- 日期：2026-10-03
- 基线：`origin/master @ eb9ab2a`。Patch B 链（`claude/coach-b*`）尚未合并，见附录 C。
- 性质：只含文档。本文不改任何代码、数据库或线上数据。

## 1. 背景与目标

**背景**
- 第一版方法（三分化）来自 B 站视频字幕：提取字幕 → AI 整理 → 人工整理成 Canonical Workbook → 手写 SQL 入库（`20260909000600` 写方法结构，`20260912000100` 写逐组模板）。
- 第二版方法来自小黑盒文字，结构是 4 个训练部位 + 腹肌日 + 有氧日 + 休息日。
- 核心用户反馈：原三分化难以坚持，难度过大。

**目标**：把"外部内容 → 方法"产品化。粘贴文本 → AI 抽取 → 金标补全 → 审核 → 生成方法与 release → 用户训练。官方方法与用户私有方法共用一条管线，仅可见范围不同。

**成功标准（均可验证）**

| 编号 | 标准 |
|---|---|
| S1 | 一段粘贴文本能变成可训练的方法，全程无需人工写 SQL |
| S2 | 导入结果中每个数字都标注来源（原文 / 金标 / AI 建议）；无来源的数字不会静默生效 |
| S3 | 更新前后，现有用户的历史数据逐表对账一致（只允许新增，不允许改动或减少） |
| S4 | 换方法后，同一动作的参考重量与历史能延续 |
| S5 | 复盘、首页、历史、周报在新旧方法下都不出现错误标签或口径漂移 |
| S6 | 现有 1.2 方法的体验不变，回归测试全绿 |

## 2. 范围与非目标

**范围**：导入管线、金标集、多日类型运行时、私有方法、用户调整层、动作级状态、影响面治理。

**非目标（本次不做）**
- 链接抓取、截图识别、视频字幕等输入（先只做粘贴文本）。
- 版权方案（已决定暂不考虑）。
- 用户之间分享方法、方法市场。
- 强制迁移现有用户到新方法。
- 重写复盘模块。
- 营养目标与训练日类型联动。
- 用户更正自动回流修改金标（先人工）。

## 3. 产品原则

- **P1 方法都是导入来的**：不存在"平台标准方法"。官方方法由内部用同一管线导入。
- **P2 事实归用户和动作**：训练事实（某天某动作每组的次数和重量）属于"用户 + 动作"。方法、报名、处方只是计划与标签。
- **P3 AI 不静默生效**：任何非原文来源的值必须带可信度标签，AI 推断值需用户确认后才生效。来源优先级：原文明写 > 金标默认值 > AI 推断。
- **P4 默认能用，事后可改**：导入页是摘要卡，只有被标出的项需要看一眼；自主权放在使用中。
- **P5 已激活的 release 不可变**：用户的个性化走"个人调整层"，不改 release。
- **P6 增量优先**：所有迁移只增不删不改。新能力用新表、新函数、新版本名。
- **P7 现有方法不动**：1.2 release 及其所有行不改；已报名用户保持固定版本。
- **P8 健康自负声明**：导入时勾选"我承诺对自己的健康负责，量力而行"后才能继续，并记录同意版本。
- **P9 不确定就标出来**：缺失或矛盾的信息进入"待确认"，不由系统猜测。

## 4. 术语

| 术语 | 含义 |
|---|---|
| 方法（method） | 一套训练计划的身份，如三分化 |
| release | 方法的不可变版本；报名时固定 |
| 报名（enrollment） | 用户加入某个方法 release 的关系；同一时刻只能有一个 active |
| 分化日（split / day） | 方法中的一天，如推、拉、腿 |
| 日类型（day type） | 力量日 / 腹肌日 / 有氧日 / 休息日 |
| 处方（prescription） | 系统为某天生成的计划动作与组次 |
| 事实（execution） | 用户实际完成的每组数据 |
| 动作身份（exercise） | 共享的动作标识，`canonical_name_zh` 唯一 |
| 金标集 | 人工核对过的动作库与方案库，用于对齐、补缺省、校验、评测 |
| manifest | 导入管线输出的统一结构，唯一写库入口 |
| 个人调整层 | 每个报名一份的覆盖项（隐藏、替换、改组次），处方生成时叠加 |
| 官方 / 私有方法 | 可见范围不同：所有人可见 / 仅创建者可见 |

## 5. 决策台账

**已锁定**

| 编号 | 决策 |
|---|---|
| D-1 | 官方与私有方法共用同一条导入管线 |
| D-2 | 输入先只支持粘贴文本 |
| D-3 | 用户导入的计划 = 私有 method + release |
| D-4 | 健康声明勾选后才能继续；版权暂不考虑 |
| D-5 | 并行开发，三条车道（运行时 / 导入 / 其他新功能），先合"契约 PR" |
| D-6 | 金标分 `draft` / `reviewed`；只有 `reviewed` 可自动补数字 |
| D-7 | 用户自主权在使用中提供，不在导入时设强制关卡 |

| D-8 | 动作粒度按"精确动作"：历史与参考重量只跟同一动作 ID；相近动作仅作"起始重量参考"提示。动作库以 workout-guide 的 302 个动作为起点（2026-10-03 确认） |
| D-9 | 先完成 Patch B（含 B8–B10），再开始本更新（2026-10-03 确认） |

**待定**

| 编号 | 问题 | 倾向 |
|---|---|---|
| O-1 | 已澄清（2026-10-03）：只有周复盘有规划；月复盘与"复盘总设置"并不存在，属于新设计。复盘信息架构（日/周/月分层置顶与折叠）见对话中的线框草案，待确认后写入文档 4 | 待确认线框 |
| O-2 | 休息日如何建模 | 不建会话，用"下一练最早解锁日期"规则；沿用现有 `rest` 状态 |
| O-3 | 有氧、腹肌的记录形态 | 假设：记录形态由"动作"决定，不由日类型决定。workout-guide 每个动作带 `exerciseType`（weight_reps 136 / bodyweight_reps 114 / duration 39 / distance_duration 10 / assisted_bodyweight 3，共 302）。当前 `save_method_set_actual` 只收 重量/次数/RIR，需新增可空的时长、距离字段。文档 2 中核实 |
| O-4 | 现有真实用户是否迁移到新方法 | 默认不强制 |
| O-5 | `workout_logs` 是否继续双写 | 现状已标注 deprecated，见文档 1 |
| O-6 | 动作"家族"是否用于起始重量提示 | 默认只提示，不共用数据 |
| O-7 | 已决（D-9）：Patch B 先行。合并 PR 的时机与目标分支仍由用户决定，我不擅自合并 | 已决 |

## 6. 硬约束

- **H1** 只增不删不改：不移动、不重写、不删除任何已有数据行。
- **H2** 回填前先出 dry-run 报告，含前后行数对账。
- **H3** 不改 1.2 release 的任何行，不改 `method_releases` 既有数据。
- **H4** 换方法或停用方法一律"归档"；用户删除私有方法只做"隐藏"。
- **H5** 新表的外键不使用 `cascade` 连接事实表。
- **H6** 动作合并与改名走别名/重定向；已被训练记录引用的动作 ID 不得重新分配。
- **H7** 不把 `exercises.canonical_name_zh` 的唯一性改为非唯一。
- **H8** 线上库的任何迁移推送，需用户明确同意后才执行。
- **H9** 旧 RPC 与旧接口保持原签名；新行为用新函数名（沿用 `_v2`、`_v3` 惯例）。
- **H10** 浏览器本地离线队列（`localStorage` 中待提交的逐组数据）必须在部署前后保持可重放。

## 7. 工作方式：每份文档的关卡

每份文档产出前，必须完成并记录：
- **G1 检索**：重新读取本文档涉及的代码与迁移，写明引用位置（文件:行）。
- **G2 审核**：自检与既有数据库、代码的冲突，列出"已核实 / 推断 / 未核实"。
- **G3 影响面**：对照附录 A，更新受影响模块与处理方式。
- **G4 冲突**：对照附录 C，确认没有与在途分支的迁移或文件冲突。

全部文档完成后，按附录 B 的命令**全量复扫一遍**，与附录 A 逐项比对，差异写入最终报告。

## 8. 文档路线图

| 编号 | 文档 | 状态 |
|---|---|---|
| 0 | 总纲与原则 | 本文 |
| 1 | 数据架构与脱钩方案（含线上只读核对 SQL） | 已写 |
| 2 | 方法数据模型（多日类型、轮转函数、可见范围、按 release 报名） | 已写 |
| 3 | 导入管线与金标集 | 已写 |
| 4 | 用户体验与自主权（含复盘信息架构：日/周/月） | 已写；复盘 5 项默认待确认 |
| 5 | 并行开发与发布计划 | 已写 |
| 6 | 测试与验收 | 已写（含 4 份已实测的 SQL 合约） |
| 7 | 给执行 AI 的任务书 | 已写 |

---

## 附录 A：影响面台账 v1

依据：2026-10-03 对 `origin/master @ eb9ab2a` 的扫描。"已核实"指已读到代码；"推断"指由外键或调用方向推出。

| 模块 | 依赖（已核实） | 受方法改动影响 | 风险点 | 处理 |
|---|---|---|---|---|
| 日复盘 | master 上只读 `workout_logs`（`lib/nutrition/daily-log.ts:120`）；**Patch B 之后**，`lib/evidence/daily-review.ts:13-19` 还读取 `method_enrollments.next_split_key`，并用 `lib/coach/display.ts:43` 写死的 `SPLIT_LABELS`（推/拉/腿）转成名称，未知键回落为原始键（最终复扫补入） | 间接 + 直接（Patch B 之后） | 见下方 A1–A4 | 文档 2、6 |
| 周复盘 | 只读 `workout_logs`（`lib/nutrition/weekly-log.ts:99`）；已声明 `method_adherence` 不可用（`:212`） | 间接 | 无法区分"休息日"与"漏练" | 文档 2、4 |
| 单次训练反馈 | `/api/ai/compose` 读 `workout_logs`（`:80`）；`session-facts` 只识别两种记录形状；Patch B 新增 `app/api/workout/session-feedback/route.ts` 读取 `workout_sessions`、`set_executions`，`lib/coach/workout-context.ts` 读取会话、处方、报名，并按 `split_key` 找上一次、用 `SPLIT_LABELS` 取名 | 间接 + 直接（Patch B 之后） | 有氧记录会被判为信息不全；软删除过滤要覆盖这些读取；名称映射 | 文档 1、2、6 |
| 月复盘及复盘设置 | 全部分支均未找到 | 未知 | 无法评估 | O-1 |
| 首页 | `workout_logs` 计数；`weekly_workout_target`（已标记 deprecated）；`next_split_key` 的类型写死为 `'push' \| 'pull' \| 'legs'`（`app/home/page.tsx:40`） | 是 | 类型约束、日类型展示、进度环口径 | 文档 2、4 |
| 历史 / 历史详情 | `workout_logs`；可删除 `workout_logs` 行（`history/[date]/page.tsx:119`） | 间接 | 删除只影响日志这一份副本（推断），与逐组事实不一致 | 文档 1 |
| 周报页与接口 | `workout_logs` + `weekly_workout_target`（`api/weekly/route.ts:22,33`） | 间接 | 口径 | 文档 4 |
| 自由训练记录 | 类型词表为胸/背/腿/肩/手臂/有氧/拉伸/其他（`app/workout/page.tsx:9`） | 间接 | 与方法路径写入的"推/拉/腿"词表不统一 | 文档 2 |
| 训练页与接口 | `today`、`sessions/*`、`start`、`sets`、`complete`、`duration`、`status`、`method/current`、`method/current/progress`（读 `method_cycles` 的 `push/pull/legs_session_id` 三列，最终复扫补入）、`method/enroll` | **直接** | 运行时写死：`PROGRAM_DAY_ORDER = ['push','pull','legs']` 与默认 `'push'`（`api/training/today/route.ts:26,196`）；类型写死：`training/today/page.tsx:39-77`、`training/sessions/[sessionId]/page.tsx:68,119`、`api/method/enroll/route.ts:13`、`api/onboarding/route.ts:18` | 文档 2（车道 A） |
| 注册引导 | 引导里 `if p_join_method` 自动调用 `initialize_current_method_enrollment()`，该函数写死方法键 `ksw_tcy_three_split_2026` | **直接** | 首次体验随"选择/导入方法"改变 | 文档 2、4 |
| 设置 / 档案目标 | 未发现与方法的耦合；导出的训练数据只来自 `workout_logs`（`api/export/route.ts:10`） | 否 | 导出不含逐组事实（数据可携带性缺口） | 文档 1 |
| 营养 | 未发现与方法的耦合 | 否 | 后续若联动训练日类型再评估 | 非目标 |
| 恢复打卡 | 按日期读取，不依赖方法 | 否 | `session_prescriptions.recovery_decision_id` 为预留 | — |
| AI 证据与反馈 | 以用户 + 日期或日志 ID 为键，不含方法键 | 否 | 上下文里的 `type`、动作名会改变输出措辞 | 文档 6 |
| 动作媒体 | `exercises` + `exercise_external_mappings`；`media` 可空 | 间接 | 新动作缺媒体需降级展示 | 文档 3 |
| 离线队列 | `localStorage` 保存待提交的逐组数据（`lib/training-offline-queue.ts`） | 间接 | 部署前后需可重放 | H10，文档 5 |
| SQL 合约测试 | 针对 `version = '1.2'` 且带校验和，按 release 取数（如 3 个分化、15 个动作、49 个模板） | 否 | 新增 release 不会触发 | 文档 6 |
| 方法运行时测试 | `tests/method-runtime/minimum-p1-runtime.test.ts`、`workout-runtime.test.ts` 含 push/pull/legs 字面量（该目录另有 6 个测试文件未逐个核实） | 是 | 需要新方法的 fixture，同时保留旧用例 | 文档 6 |
| 测试账户脚本（PR #12） | 假设首个处方为 Push，注册自动加入方法 | 是 | 注册引导变化后需更新或新增画像 | 文档 6 |

**需优先处理的四个具体风险**
- **A1 标签误标（高）**：完成训练 RPC 把分化键映射为日志类型时，`case split_key when 'push' then '推' when 'pull' then '拉' else '腿' end`（`20260925000500:469-474`）。任何新分化键会落入 `else`，被写成"腿"，直接污染历史、周报和复盘。
- **A2 记录形状（中）**：`lib/workout/session-facts.ts` 仅理解两种持久化形状（方法路径、自由训练）。有氧日若没有新的形状，会被判为"信息不全"。
- **A3 删除语义（中）**：删除历史里的日志只影响 `workout_logs`，不影响逐组事实表，复盘与方法进度可能不一致。需在文档 1 明确"哪一份是事实"。
- **A4 名称回落为原始键（中，最终复扫补入）**：`SPLIT_LABELS` 只有三项，未知键回落为原始键，新方法会把 `chest` 这类英文内部值带进教练文案与日复盘证据。已列入文档 2 第 8 节与文档 7 的 A7。

## 附录 B：扫描命令（可复现）

```text
# 复盘与月度
Grep: monthly|月复盘|月报|月度|按月            （ts/tsx/sql/md，全部远程分支）
# 谁读取训练相关表
Grep: from\('(workout_logs|session_prescriptions|exercise_prescriptions|set_prescriptions|workout_sessions|exercise_executions|set_executions|method_enrollments|method_cycles|method_splits|method_rules|method_releases|methods|method_split_exercises|user_exercise_progression|exercises)'\)
# 谁调用 RPC
Grep: \.rpc\('
# 分化键写死
Grep: 'push'|'pull'|'legs'
# 路由与页面全量
find app -name route.ts ; find app -name page.tsx
# 在途分支
git rev-list --count origin/master..<branch>
```

## 附录 C：在途分支与冲突清单

**Patch B 链（未合并，目标分支 `coach-ai-patch-2026-09-27`）**
- 迁移：`20260926000700_ai_generations.sql`；`20260926000800_session_duration_set_span.sql`（整函数重定义 `complete_method_session_v2`）。
- 涉及文件：`app/home/page.tsx`、`app/weekly/page.tsx`、`app/training/sessions/[sessionId]/page.tsx`、`app/training/method/*`、`app/settings/*`、`lib/evidence/*`。
- 影响：这些正是车道 A 的改动范围。新的完成函数若基于 `master` 上的旧版本，会**悄悄丢掉 B5 的时长逻辑**。因此车道 A 的迁移必须基于最新定义，合并顺序见 O-7。

**完成函数的轮转逻辑重复**
- master 上至少 4 个迁移文件（`20260911000200`、`20260925000200`、`20260925000400`、`20260925000500`）里各含一份，B5 再加一份（整函数重定义）。后续应抽成单一函数 `next_program_day(...)`，由各 RPC 调用。

**其他分支（相对 master 仍有未合并提交，是否已以其他形式并入需确认）**
- `codex/internal-beta-runtime-truth`（领先 4 个提交，内容含训练日期导航、重量单位切换）
- `codex/p0-1-runtime-reliability`（领先 1 个提交）

## 附录 C-2：Patch B 现状与本更新的接口（2026-10-03 核实）

**PR 状态**：#1–#11 全部处于 open，没有任何一个合并。#12（测试账户脚本）基于 master，也是 open。
- T 链：#1（T0）、#2（T2）、#5（T1）以 `coach-ai-patch-2026-09-27` 为基；#3（T3）叠在 #2 上，#4（T4）叠在 #3 上。
- B 链：#6（B1）以 `claude/coach-patch-b-spec` 为基；#7（B2）→ #6，#8（B3）→ #7，#9（B4）→ #8，#10（B5）→ #9，#11（B6）→ #10。
- `claude/coach-patch-b-spec` 包含 T0、T2、T4，不包含 T1（#5）。

**尚未做的 Patch B 任务**：规格分支上另有 `PATCH_B_ADDENDUM_B8-B10.md`（晚于 B1 分支创建时间提交），内含 B8（开屏恢复卡）、B9（每日日志训练卡）、B10（每日日志饮食卡）。规格建议顺序为 B1 → B8 → B9 → B10 → B2 → …，已完成的 B2–B6 没有按此顺序，B8–B10 计划叠在 #11 之上。B7 仍待用户提供真实输出。是否按 B8 → B9 → B10 各一个 PR 叠在 #11 之上来做，待用户确认（**O-35**）。

**B8–B10 与本更新的耦合点**
1. B8 把 `split_key → 显示名/部位` 写成三项对照表（push/pull/legs），并用 `next_split_key` 判断"是否同一组"。实现时应把对照集中在单一函数里，遇到未知 `split_key` 时整题不出现，便于本更新改为读取方法数据（`method_splits.primary_focus` 已存在）。
2. B9 要求"和上次比较"取"同一 split 上一次完成的训练"。现有实现 `lib/coach/workout-context.ts:98-135`（`loadLastTime`）同样以 `split_key` 为范围，并且只在那一次训练里找同一动作。与 D-8、P2（数据跟动作走）不一致：用户"五选三"裁剪动作，或换方法后，会找不到上次。建议改为"该用户该动作最近一次已完成的执行"（**O-34**，待用户确认，属于对规格的偏离）。
3. B9 改为读取 `workout_sessions` + `exercise_executions` + `set_executions` + `set_prescriptions`，这与文档 1 要明确的"哪一份是事实"一致，B9 即是第一个把读取切到事实表的页面。
4. B9、B10 修改 `app/history/[date]/page.tsx`，即复盘信息架构里"日"的详情页。
