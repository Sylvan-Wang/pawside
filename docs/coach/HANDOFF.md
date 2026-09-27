# Coach AI 交接说明（给接手开发的 Claude Code）

更新：2026-09-27。产品负责人：Sylvan。所有产品判断以他为准；拿不准的，写进 PR 说明里问他，不要自己决定。

## 0. 按这个顺序读

1. 本文件
2. `docs/COACH_AI_PATCH_2026-09-27.md`：今天已经做了什么、用了哪些开关、还有哪些数据没核实
3. `docs/coach/METHOD_RULES.md`：训练方法规则。写任何训练相关的文案或规则之前必须先读
4. `docs/coach/PAWSIDE_COACH_AI_SPEC.md`：完整开发规格（阶段 A0 / A / B / C）和附录 A 的理想输出样例
5. `docs/coach/skeletons/README.md`：规格里提到的"上一轮骨架"放在这里
6. `AGENTS.md`：本仓库用的是 Next.js 16，写代码前先看 `node_modules/next/dist/docs/`

## 1. 产品和现状

- Pawside 是一个 AI 健身教练 App，训练方法是「凯圣王 × 谭成义 2026 三分化」（推 / 拉 / 腿）。
- 内测只有 **2 个用户**（Sylvan 本人和一位目标用户）。所以**不做**成功率统计、LLM 自动评分、大规模金标集、prompt 回归基线。质量标准是附录 A 的样例，由 Sylvan 看真实输出来判断。
- 用户的主要反馈是"感觉不到 AI"：报告没有训练感，日报一直在说数据完整性，看不出每一组有什么区别。今天的 patch 处理了这一部分。
- 核心原则：**规则负责判断，模型只负责挑重点和写文案。**数字、阈值、是否达标、下一步能做什么，都由确定性代码算出来；模型不计算，也不下判断。

## 2. 分支状态

- `coach-ai-patch-2026-09-27`：今天的 patch，**还没合进 master**。先在这个分支上继续，或者等它合进去以后再从 master 切新分支。
- master 很可能连着 Netlify 自动部署。**不要直接推 master**，也不要自己合 PR，合并由 Sylvan 决定。
- 新改动都放在 `PAWSIDE_COACH_*` 环境变量开关后面，默认开启，设成 `0` 就退回旧行为。开关定义在 `lib/coach/flags.ts`。

## 3. 规格与仓库的差异（以仓库为准）

| 规格里写的 | 仓库实际情况 | 你该怎么做 |
|---|---|---|
| D21：每餐参考量 = 日目标 ÷ 3，上限为参考量 × 1.5 | **已作废。**改用 `lib/nutrition/guidance.ts#buildMealCalorieRanges`（早 25–30%、午 30–40%、晚 30–35%），上限取范围的上沿；加餐没有范围 | A2 按新口径做；`lib/coach/meal-context.ts` 已经实现了整餐合并和范围判断 |
| MUST 3：模型输出里只能写占位符，不能有裸数字 | 还没做。现在靠数字可追溯检查（`composer.ts`），外加 `extraAllowedNumbers` | 这是 A0-1 / A0-2 的内容，做完以后替换现有检查 |
| `lib/evidence/coach-output.ts`、`output-checks.ts`、`render-values.ts`、composer v4 | **已由 DSH 实现**，在分支 `deepseek/coach-ai-a0-wp1-wp2`（commit `71e47d3`，基于 master `eb9ab2a`；163 个 evidence 测试通过）。截至 2026-09-27 还没推到远端 | **不要按规格重新实现。**等它推上来以后，以它为准，把本分支的输出守卫、`extraAllowedNumbers` 等合并进去，只留一套实现 |
| A0-1 / A0-3 "直接采用上一轮骨架" | 骨架在 `docs/coach/skeletons/pawside-ai-p0-0.zip`，**迁移编号冲突** | 看 skeletons/README |
| A3 训练后反馈 | 一部分已完成：关键组、处方与实际对比、下次训练的关键组（`lib/coach/workout-context.ts`） | 剩下的是 A0-4 的统一输出结构、`allowed_actions` 和行动行 |
| AI 出口读 `workout_logs` | 仍然在读（它是正式执行表的镜像，通过 `method_workout_session_id` 关联） | 新代码优先读 `workout_sessions` / `exercise_executions` / `set_executions` |

## 4. 硬约束（违反就算没完成）

1. 数字只能来自 facts，或者来自规则算出的计划数字；模型不计算。
2. 用户看到的文字里不能出现内部用语：`§`、`AI Patch`、`partial`、英文枚举、字段名、证据编号。已有拦截：`lib/coach/display.ts#findInternalTerms`。
3. 每个节点只有一个 Coach 区块。有 AI 文字时不再同时显示规则卡片；AI 失败时显示"基础总结"，并且要能看出来这是基础总结。
4. 模型不能改训练处方。任何调整都只能走"提案 → 用户确认 → 写入"（阶段 C）。
5. 不说"过度训练""你不能练""明天补回来"，不做诊断，不因为一次挑战组做到了就建议加重量，不催休息日的人去练。详见 METHOD_RULES 第 2 节。
6. "完成这一组"必须由用户点击；不要改成自动提交（它会影响完成数和进阶）。
7. 不要直接修改 Method 发布数据（`method_releases` 及相关的模板表）。要改只能走 importer 出新的 release。
8. 用户文案用中文，简短平实，不要免责声明和套话。

## 5. 环境

- **线上数据库是 Supabase 项目 `sbwevlhzqujrtucppacl`**（见 `IMPLEMENTATION_STATUS.md`）。它**不在** Sylvan 这个 Supabase 账号下（他账号里那个叫 pawside 的项目 `myvnxfwqrmnutfafrijl` 已经暂停，而且不是线上库）。需要读线上数据的话，找 Sylvan 要权限，或者让他跑 SQL。
- 本地 `npm run build` 至少需要 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`；只做编译检查的话，填占位值也能过。真要调用 AI 还需要 OpenAI 的配置，见 `PAWSIDE_OPENAI_TEST_RUNBOOK.md`。
- 每次提交前运行：`npx tsc --noEmit`、`npx vitest run`、`npm run build`。

## 6. 任务清单（按顺序做）

每个任务一个 PR，分支名用 `coach/<任务号>-<短名>`；如果环境只允许 `claude/` 前缀，就用环境给的名字。后一个任务可以从前一个任务的分支切出来，PR 目标设成前一个分支。PR 说明用中文写，包括：改了什么、用了哪个开关、怎么验收、有哪些不确定的地方。

| # | 任务 | 验收 |
|---|---|---|
| T0 | 审一遍今天的 patch（`coach-ai-patch-2026-09-27`），修掉发现的问题 | Sylvan 按 patch 文档第 6 节实际测过一遍 |
| T1 | 数据核实：patch 文档第 4 节的 D1–D5。**只查不改**，把结论和建议改法写成一份文档 | 每一项都有结论，或者写明需要谁提供什么 |
| T2 | **整合**（A0-1 + A0-2 已由 DSH 完成）：`deepseek/coach-ai-a0-wp1-wp2` 推上来以后，把本分支（含 T0 修复）rebase 到它上面。`composer.ts` 和 `app/api/ai/daily-review/route.ts` 一定会冲突：以 DSH 的 v4 管线为准，把本分支的内部用语拦截、重试和计划数字白名单并进 `output-checks`，删掉重复实现。`docs/coach/skeletons/` 里的 output-checks 骨架作废 | DSH 的测试和本分支的测试全部通过；`lib/` 里只有一套数字检查、一套输出守卫 |
| T3 | A0-3：生成日志 `ai_generations`（重新编号迁移） | 成功和失败的生成都有记录；写日志失败不影响主流程 |
| T4 | A0-4 + A0-5：统一输出结构 `coach_output_v1` 和三态卡片 `CoachCard` | History 等旧调用方不受影响（兼容层）；三种状态都能在页面上看出区别 |
| T5 | A1：首页 Coach 卡片 | 附录 A 的 S1–S5，外加"AI 失败"一条 |
| T6 | A2（按新的餐口径）：餐后反馈显示剩余预算，新增蛋白质信号 | 附录 A 的 M1–M5；"午餐少了晚餐可以补"要成立；不能出现跨天补偿 |
| T7 | A5："为什么？"浮层 | 浮层里每个字都能追溯到注册表或 facts；不调用 LLM |
| T8 | A6：行动行 + `coach_action_events` | 5 种 `action_type` 都能点；"不需要"可用；完成后变灰 |
| T9 | A4：周报接线 | W1、W2、W3、W5 |
| T10 | A7：小黑猫提醒（视觉素材到位前用占位图形） | 一天最多一个气泡；训练中隐藏 |

阶段 B / C 先不做，等 Sylvan 看过阶段 A 的真实输出再说。

## 7. 等 Sylvan 决定的事（不要替他定）

- 训练时长用哪个口径：默认"第一组到最后一组"；备选"点开始到点结束"（开关 `PAWSIDE_COACH_DURATION_BASIS`）
- `methods` 表那一行的版本标签要不要同步成 1.2（运行时读的是 release，所以这件事不影响功能）
- 三个 prompt 的语气和先后顺序：看过真实输出以后再调
- 卧推 RPE 8 / RIR 2 这类数值目标：什么时候通过 importer 出新 release 写进模板

## 8. 什么时候停下来问

- 需求和本文件或规格冲突
- 需要改数据库发布数据，或者需要删除用户数据
- 一个改动会让用户看到的文案明显变多
- 你打算新增一个规格里没有的 AI 调用
