> **仓库内副本（2026-09-27 同步）。** 原件在 claude.ai 的 PAWSIDE 项目里。先读 `docs/coach/HANDOFF.md`。
> 这份规格写于 `coach-ai-patch-2026-09-27` 之前，和仓库现状有 5 处差异，以 HANDOFF 第 3 节为准：
> 1. D21（每餐参考量 = 日目标 ÷ 3，上限 × 1.5）已作废，改用 `lib/nutrition/guidance.ts` 的比例范围，上限取范围上沿。
> 2. MUST 3（占位符模式、禁止裸数字）尚未实施。当前靠数字可追溯检查，外加 `extraAllowedNumbers`。
> 3. 文中提到的 `lib/evidence/coach-output.ts`、`composer.ts:367 PLACEHOLDER_MODE_RULES` 在任何远端分支都不存在。
> 4. A0-1 / A0-3 的"上一轮骨架"不在 `lib/`，在 `docs/coach/skeletons/`，迁移文件编号需要重排。
> 5. A3 训练后反馈的一部分已由今天的 patch 完成（关键组、处方 vs 实际、下次关键组）。

# Pawside Coach AI 闭环开发规格 v1.0（定稿）

**日期**：2026-09-27　**状态**：设计已定稿，可进入开发　**适用对象**：Codex / 工程实现者
**来源**：《Pawside AI 功能逐项设计评审》及其"阶段 A 输出样例"标签页（含全部裁决与批注）、`ai-surface-audit.md`、`ai-full-reference.md`（2026-09-26 代码审计）

---

## 0. 读我（给 Codex）

### 0.1 这份文档是什么

它把 10 个 AI 维度的设计定稿转成可以直接开发的工作包，按阶段 A → B → C 排列。每个工作包都包含目标、改动位置、输入、输出、UI 和验收标准。

### 0.2 标记约定

| 标记 | 含义 | Codex 应该怎么做 |
| --- | --- | --- |
| **MUST** | 硬约束，违反即不合格 | 严格遵守 |
| **VERIFY** | 本文依据代码审计写成，仓库可能已变 | 动手前先在仓库里核实，不一致时以仓库为准，并在 PR 描述里说明 |
| **NEW** | 需要新建的表、字段、fact 或文件 | 按本文命名新建 |
| **DEFAULT** | 设计评审中没有被单独确认、按设计默认值写入的决定 | 按本文实现，PR 描述里列出，方便产品复核 |

### 0.3 工作方式

- 每个工作包一个 PR，不跨阶段合并。
- 每个 PR 都附上它对应的验收样例（附录 A），并注明样例是否通过。
- 不改 Method、处方、营养计算的真值逻辑，除非工作包明确要求（只有阶段 C 会要求）。
- 现有测试全部保持通过；新增逻辑必须有单元测试。

---

## 1. 闭环完成度预估

"闭环"指的是：**记录 → 规则判断 → AI 解释 → 可执行的下一步 → 用户确认 → 写入下一次 → 再记录**。

| 维度 | 现在已有 | 完成度（估） | 还差什么 | 规模 | 阶段 |
| --- | --- | --- | --- | --- | --- |
| 1. AI Presence | 3 个结果页调用 AI | 30% | Home 读全字段、三态展示、小黑猫提醒 | M | A |
| 2. AI Intelligence | 逐条复述 signals | 20% | 3 条关系信号、主焦点优先级、`primary_focus` | M | B |
| 3. Context | 只有单日 / 单次数据 | 15% | `buildCoachSnapshot`、双周身体块 | M | B |
| 4. Action | 纯文字建议 | 10% | 行动行（A），Proposal 与调整卡（C） | L | A + C |
| 5. Continuity | 无 | 5% | 按节点传入；周报回顾上周重点 | S | B |
| 6. Training guidance | 训练后有反馈，训练前 / 中静态 | 25% | 训练前简报、训练中规则提示、处方 vs 实际 | L | B |
| 7. Nutrition | 餐后点评，remaining fact 已有 | 45% | 剩余预算结构、每餐参考量与上限 | S | A |
| 8. Weekly | 后端完整，前端未接 | 60% | 接 UI、逐日数据表、模式核对、双周身体 | M | A（接线）+ B（逐日数据） |
| 9. Explainability | citations 与 `/api/evidence` 已有，未上屏 | 60% | "为什么？"浮层 | S | A |
| 10. Recovery / progression | 有表（`user_exercise_progression` 等），无引擎 | 10% | 进阶引擎、恢复引擎、接入调整卡 | L | C |
| **整体** | | **约 28%** | | | |

**工作量粗估**（1 名开发者配合 Codex，含自测；不含设计素材制作）：

| 阶段 | 内容 | 粗估 |
| --- | --- | --- |
| A0 共享基础 | 输出检查、生成日志、统一 schema、三态 | 3–4 天 |
| A | 5 个前端 / 输出工作包 + 小黑猫 | 7–10 天 |
| B | Snapshot、关系信号、训练前简报、处方 vs 实际、周报逐日数据 | 10–14 天 |
| C | Proposal、进阶与恢复引擎、调整卡 | 12–18 天 |
| **合计** | | **约 6–9 周** |

阶段 A 做完，整体完成度大约到 55%，这时实测就能明显感到"AI 在"。阶段 B 做完大约 80%。阶段 C 做完，才是真正的闭环。

**本文仍然无法替代的三件事**：
1. 所有 **VERIFY** 项需要对照仓库确认，尤其是 Method / 处方相关表的字段名。
2. 小黑猫需要视觉素材（插画与动效），本文只定义行为。
3. prompt 的最终措辞需要用附录 A 的样例实测、迭代，本文只给要点。

---

## 2. 已定决策清单

以下决策都已定稿。标 **DEFAULT** 的是评审中没有单独确认、按设计默认值写入的决定。

| # | 维度 | 决策 |
| --- | --- | --- |
| D1 | 1 | 5 个判断节点：训练前、训练后、餐后、一天结束（Home / History）、一周结束。每个节点只有一个 Coach 块；训练中不放 AI 块 |
| D2 | 1 | 训练前简报放在阶段 B |
| D3 | 1 | Home 卡片的"下一步"做成可点击按钮 |
| D4 | 1 | **DEFAULT** 采用侧边小黑猫作为 Coach 形象和统一的提醒入口（由产品在评论中提出） |
| D5 | 1 | **DEFAULT** 小猫气泡只用于首批三种情况：周报生成、双周身体变化生成、有待确认的调整卡 |
| D6 | 2 | 首批 3 条关系信号：`stall_with_low_fuel`、`adherence_vs_duration`、`fatigue_before_load` |
| D7 | 2 | 主焦点优先级：安全 > 坚持 > 训练执行 > 热量 > 蛋白 > 细节。"训练排在营养前"标为 D 级 Pawside 判断 |
| D8 | 3 | Snapshot 时间窗口为 7 天 |
| D9 | 3 | 身体数据按双周纳入 Snapshot，并预留 `body.photo_checkpoints` |
| D10 | 4 | 首批 `action_type` 共 5 个：`log_meal`、`complete_record`、`view_next_session`、`add_recovery_checkin`、`none` |
| D11 | 4 | 行动行支持"不需要"（忽略）；被忽略的建议，周报不再回顾 |
| D12 | 4 | **DEFAULT** 用户完成动作后不立即重新生成 Coach 文案，只由规则把这一行标为已完成 |
| D13 | 4 | **DEFAULT** 调整卡只能整张应用或整张拒绝；需要选择时，规则最多给 2 个完整方案 |
| D14 | 4 | 阶段 C 所有调整都需要用户先确认，没有自动执行 |
| D15 | 5 | 日报不提昨天，只带 Method 位置信息 |
| D16 | 5 | 周报模式阈值为本周 ≥ 3 天 |
| D17 | 6 | **DEFAULT** 训练前简报每次训练前都出一句话；只有在有变化时（恢复差、时间不够、上次没完成）才加动作级提醒 |
| D18 | 6 | **DEFAULT** 训练中首批规则提示清单见 B5（评审中已同意由工程给出） |
| D19 | 7 | 允许给出具体食物的例子（如鸡胸、鱼、豆腐），但不带克数（Product Patch §26） |
| D20 | 7 | 不按钟点判断餐次，删除"最后一餐"的逻辑 |
| D21 | 7 | 每餐参考量 = 用户日目标 ÷ 餐数（默认 3）；当天补量时单餐上限为参考量 × 1.5（D 级）；不按体重计算 |
| D22 | 7 | 当天内可以在后面几餐补足，禁止跨天补偿 |
| D23 | 8 | 一周从 Method 周期起始日开始算；双周也按这个起始日算 |
| D24 | 8 | 周报生成后通过小猫气泡提醒，不在 Home 顶部另放入口 |
| D25 | 8 | 周报的模式由模型从本周逐日数据表中提出，服务端逐天核对后才展示 |
| D26 | 9 | 入口用文字"为什么？" |
| D27 | 9 | **DEFAULT** Home 卡片上也放"为什么？"（与 D1 设计一致） |
| D28 | 10 | 进阶规则采用 double progression；每次加一个最小增量（杠铃 2.5 kg，哑铃加到下一档） |
| D29 | 10 | 恢复调整 4 档：保持、每个动作减一组、按比例缩短到 45 分钟版、顺延一天 |
| D30 | 10 | 动作之间平等，不设保护名单；调整只改组数，不删动作 |

---

## 3. 全局硬约束（MUST）

1. **规则判断，模型取舍和表达。** 数字、阈值、趋势、候选动作、是否兑现、是否调整，全部由确定性代码计算。模型只负责选主焦点、写文案、在候选中做选择。
2. **一个 Coach，一套结构。** 所有节点都使用 `coach_output_v1`（见 4.3）。
3. **数字只来自 facts。** 模型输出中的用户可见文本不允许出现裸数字，只能写 `{{metric_key}}` 占位符，由服务端渲染。星期、"两份"这类汉字表达不算数字。
4. **数据不足就诚实说，AI 失败就明确标出。** `not_assessable` / `insufficient_data` 的信号不能被写成判断；降级文案必须标注"基础总结"。
5. **每次生成都保存输入和输出**，成功和失败都要保存。
6. **模型不能写处方。** 任何对处方的修改都只能走 Proposal → 用户确认 → policy 校验 → 写入的路径（阶段 C）。
7. **不做这些事**：成功率统计面板、LLM 自动评分、大规模金标集、prompt 回归基线（等用户量上来再做）；自然语言记账；Chat 入口本身（只预留接口）。
8. **Registry 的禁用表述在输出端强制检查**，命中即判为失败并重试一次。
9. **禁止的说法**（无论注册表是否收录）：跨天补偿（"明天补回来"）、"过度训练"、"你患有"、单日体重等于减脂成败、体脂率估算、把剩余蛋白换算成具体食物的克数。

---

## 4. 阶段 A0：共享基础设施

阶段 A 的所有工作包都依赖这里，先做。

### A0-1 输出检查模块

- **NEW** `lib/evidence/output-checks.ts`。上一轮已经给出骨架（15 个单元测试通过），直接采用。
- 功能：
  - `renderOutput(raw, facts)`：把 `{{metric_key}}` 替换为 fact 的值加单位；整数原样输出，小数保留 1 位。
  - `findBareNumbers(raw)`：检查用户可见字段里的裸数字（含全角数字）。
  - `findForbiddenClaims(rendered, signals, registry)`：检查本次信号所引用证据的 `forbidden_claims`，再加上 3.9 的全局禁用词。
  - `findUnknownEvidenceIds`：输出里的 evidence id 必须存在于注册表，且在本次输入中提供过。
  - `findEscalatedStatuses`：模型给出的 status 不能比规则的判断更强；`not_assessable` 不能变成任何判断。
  - **NEW** `findInvalidActionTypes(output, allowedActions)`：`action_type` 必须在本次输入给出的 `allowed_actions` 之内。
  - `retryHint(failures)`：生成重试时附加的反馈文字。
- **MUST** 这是唯一一套数字检查实现。接入后删除或停用 `validateNumericIntegrity`（`interpret.ts`）、`hasTraceableNumbers` / `findUntraceableNumbers`（`interpretation.ts`），只保留测试迁移。**VERIFY** 这三个函数目前仍然只在测试中被调用。

### A0-2 接入 Composer

- 改 `lib/evidence/composer.ts#composeWithEvidence`：
  1. 保留现有的 `unbound_evidence` 前置检查。
  2. 新 prompt 版本（v4）走 `placeholderMode = true`：用 A0-1 替代现有的 `allowedNumbers` 数字闸门。旧版本（v3）的行为保持不变。
  3. 任一检查失败时，带上 `retryHint` 重试 **1 次**；仍然失败，返回 `ok: false`，`reason` 取第一个失败原因。新增 `reason` 取值：`forbidden_claim`、`bare_number`、`unresolved_placeholder`、`invalid_action`。
  4. 返回渲染后的输出。
- **MUST** 失败时仍然返回 HTTP 200 + `ai: null` + `ai_status`，不影响事实层（维持现有契约）。

### A0-3 生成日志

- **NEW** migration `ai_generations`，以上一轮骨架为准（`supabase/migrations/20260926000400_ai_generations.sql`），保留 Chat 预留字段（`trace_id`、`parent_generation_id`、`invoked_by`、`turn_index`，surface 含 `coach_chat`）。
- `fail_reason` 的 check 约束补上：`bare_number`、`unresolved_placeholder`、`invalid_action`。
- **NEW** `lib/ai/generation-log.ts#logGeneration`：永不抛错；由 `composeWithEvidence` 在每次尝试后调用（重试记为 `attempt = 2`）。
- 保留期 90 天（定时删除，service role）。
- 不做统计面板。开发期用 SQL 直接查即可。

### A0-4 统一输出骨架 `coach_output_v1`

所有 surface 升一个 prompt 大版本（`openai_daily_review_v4`、`openai_meal_feedback_v2`、`openai_workout_session_feedback_v2`、`openai_weekly_review_v2`），schema 改为以下公共字段加各节点的专属字段。**MUST** 保持 `strict: true`、`additionalProperties: false`。

```json
{
  "headline": "string, ≤40 字",
  "primary_focus": { "signal_keys": ["string"], "why_now": "string, ≤60 字，不在 UI 显示" },
  "evidence": [
    { "text": "string, ≤60 字", "signal_key": "string", "status": "enum", "evidence_ref_ids": ["string"] }
  ],
  "next_actions": [
    { "text": "string, ≤40 字", "action_type": "log_meal|complete_record|view_next_session|add_recovery_checkin|none", "basis": "method|rule|evidence" }
  ],
  "data_quality_tip": "string|null",
  "safety": { "level": "none|caution|warning", "text": "string|null", "evidence_ref_ids": ["string"] }
}
```

| 字段 | 由谁产出 | UI | 取代的旧字段 |
| --- | --- | --- | --- |
| `headline` | 模型 | 卡片标题 | daily `overall`；workout / meal `summary`；weekly `what_happened` |
| `primary_focus` | 模型从规则排好序的信号中选 | 不显示 | 新增 |
| `evidence` | 模型写文案；status 与 evidence id 必须来自输入 | 标题下方，每条带"为什么？" | daily `key_findings`；workout / meal `observations` |
| `next_actions` | 模型写文案；`action_type` 从 `allowed_actions` 中选 | 行动行（A6） | daily `tomorrow_guidance`；weekly `next_week` |
| `data_quality_tip` | 模型 | 卡片底部灰字 | 保留 |
| `safety` | 规则决定级别，模型写文案 | 有内容时置顶 | daily `safety`；meal `safety_note` |

**各节点上限**

| 节点 | evidence | next_actions | 专属字段 |
| --- | --- | --- | --- |
| 每日复盘 | ≤ 2 | ≤ 2（Home 只显示第 1 条） | — |
| 餐后 | ≤ 1 | ≤ 1 | `budget` 由前端用 facts 渲染，不在模型 schema 中 |
| 训练后 | ≤ 2 | ≤ 2 | — |
| 周报 | 0（改用 `patterns`） | ≤ 2 | `patterns`、`last_week_review`、`body_change`（见 A4 / B6） |

**输入端新增的公共字段**（放进 payload 的 `context`）：
- `allowed_actions: string[]`：规则按当前状态给出。例如没有缺失记录时，就不给 `complete_record`。
- `ranked_signals: string[]`：按 D7 的优先级排好序的 signal key（阶段 A 先按安全 > 训练 > 营养的粗排，阶段 B 换成 B2 的完整排序）。

**兼容**：`compatibleReview()` 等兼容层继续产出旧字段，避免破坏 History 等现有调用方，直到对应前端迁移完成。

### A0-5 三态展示

- **NEW** 前端组件 `CoachCard`，所有节点共用。状态由 `ai_status` 与数据决定：
  - `ai`：`ai_status.available === true`，展示 `coach_output_v1`。
  - `basic`：AI 失败，显示事实层的基础总结，标签为"基础总结"，附【重试】按钮。**MUST** 不显示 provider、错误码、原始错误信息。
  - `insufficient`：没有任何记录，显示"补记什么会有帮助"。
- `home`、`history` **MUST** 开始读取 `ai_status`（审计确认目前都不读）。
- 同一天的 Home 和 History 读同一次生成的结果。

---

## 5. 阶段 A：接线与输出

完成标志：在 S1–S5 下，每个节点都有具体的输出，并且能分辨是 AI 还是基础总结。

### A1 Home Coach Card（维度 1）

- **改动**：`app/home/page.tsx`（**VERIFY** 目前在约 212 行只取 `summary`）改为使用 `CoachCard`，读取 `/api/ai/daily-review` 的 v4 输出。
- **显示**：`headline` + `evidence[0]` + `next_actions[0]`（行动行）+ 每条 evidence 的"为什么？"（D27）。
- **History**（`app/history/[date]/page.tsx`）显示全部字段。
- **输入**：沿用 `buildDailyReviewEvidence`。按 D15 **只**额外加入 Method 位置 facts（阶段 A 能取到多少就放多少，其余到 B1 补齐）：
  - **NEW** `method.next_split`（文本）、`method.next_session_date`（日期）、`method.is_rest_day_tomorrow`（布尔）。**VERIFY** 这些可以从 `method_cycles` / `session_prescriptions` 读到。
- **MUST** 日报不传入、也不提及前一天的缺口或建议。
- **验收**：附录 A 节点 1 的 S1–S5 和"AI 失败"共 6 条。

### A2 餐后剩余预算（维度 7）

- **改动**：`app/api/ai/compose/route.ts` 的 `meal_feedback` 分支；`app/food/FoodPageClient.tsx`（**VERIFY** 目前在约 503 行）。
- **NEW facts**（规则计算，写进 `buildNutritionFacts` 或其旁边）：
  - `nutrition.calories_meal_ref` = `calories_target ÷ planned_meals`；`nutrition.protein_meal_ref` 同理。`planned_meals` 默认 3（**NEW** 用户设置项，可以之后再做 UI，先用默认值）。
  - `nutrition.calories_meal_cap` = `meal_ref × 1.5`；`nutrition.protein_meal_cap` 同理。
  - `nutrition.next_meal_protein_suggested` = `min(protein_remaining, protein_meal_cap)`；热量同理。
  - `training.is_training_day`（布尔，来自当日 `workout_logs` 或当日处方）。
  - 已有：`nutrition.meal_count`、`*_consumed`、`*_target`、`*_remaining`。
- **NEW signal** `nutrition.protein`：仿照现有 `computeMealFeedbackStatus` 对热量的做法，按蛋白的已吃与目标给出 `within_reference / below_reference / above_reference / not_assessable / insufficient_data`，`domain = user_target`，`authority` 采用 `Product Patch` 前缀。现在只有热量有信号，蛋白没有，而样例的主焦点大多是蛋白。每日复盘（A1）也使用这个信号。
- **规则**：
  - 不看钟点（D20）。
  - 剩余量大于 `meal_cap` 时，建议量取 `meal_cap`；剩下的部分不追，也不带到第二天（D21、D22）。
  - 超出目标时，只陈述超出多少，不做评价，`next_actions` 为 `none`。
  - 可能漏记（本餐热量 < `calories_meal_ref × 0.3` 且只有 1 个条目）时，`allowed_actions` 给出 `complete_record`。阈值为 **DEFAULT**，可调。
- **UI**：`budget` 块由前端直接用 facts 渲染热量和蛋白的"已吃 / 目标 / 还剩"，不经过模型；下方是 `headline` 和最多 1 个行动行。
- **prompt 要点**：只说"还剩"，不说"不足"；下一餐建议写到食物类别，可以举例（D19），但不写克数；训练日和休息日的建议要有区别。
- **验收**：附录 A 节点 2 的 M1–M5。

### A3 训练后反馈（维度 6 的阶段 A 部分）

- **改动**：`workout_session_feedback` 分支；`app/training/sessions/[sessionId]/page.tsx`（**VERIFY** 目前在约 594 行）。
- **阶段 A 能用的 facts**：`training.session_duration`、`training.exercise_count`、`training.completed_exercise_count`、`training.completed_set_count`、`training.total_volume_kg`、`recovery.post_workout_self_report`，以及 **NEW** `profile.available_minutes`（来自 onboarding；**VERIFY** 字段位置）。
- **allowed_actions**：`view_next_session`；有缺失记录时加 `complete_record`；自评低时加 `add_recovery_checkin`。
- **MUST** 不写"过度训练"或"训练量必须降低 X%"（注册表禁用）。
- **验收**：附录 A 节点 3 的 T1–T5（标 Ⓑ 的内容在阶段 A 不要求）。

### A4 周报接线（维度 8 的阶段 A 部分）

- **改动**：`app/weekly/page.tsx`（**VERIFY** 目前在约 351 行写着"待接入"）调用 `POST /api/ai/compose`，`surface = weekly_review`。
- **一周的范围**：从 Method 周期起始日开始（D23）。**VERIFY** 起始日可以从 `method_enrollments` / `method_cycles` 读到；取不到时退回周一，并在 PR 中说明。
- **输入**：阶段 A 沿用现有的 `WeeklyReviewInputContract`（含 `computed_trends`、`unavailable_metrics`），加上 **NEW** `method.planned_sessions` / `method.completed_sessions`。逐日数据表在 B6 再加。
- **输出**：`headline` + `patterns`（阶段 A 只允许基于 `computed_trends` 的趋势，每条也要带 `days` / `metric_keys`）+ `last_week_review` + `next_actions`（≤ 2）+ `data_quality_tip`。
  - `last_week_review`：由规则判断上周 `next_actions` 是否做到，给出 `done` / `total`，模型只写 `text`。被忽略（D11）的建议不计入。第一周为 `null`。
- **生成时机**：本周结束后第一次打开时生成并缓存（**NEW** `ai_generated_content.content_type = 'weekly_review_ai'`，`target_date` = 周起始日）；本周进行中打开时现算，标注"截至今天"。
- **验收**：附录 A 节点 4 的 W1、W2、W3、W5（W4 在 B6）。

### A5 "为什么？"浮层（维度 9）

- **NEW** 前端组件 `WhySheet`，入口文字为"为什么？"（D26）。出现在每条 `evidence` 旁，以及 Home 卡片上（D27）。
- 数据来源：`/api/evidence?ids=`（已有），外加本次输出对应的 facts 和 signals。
- 按 Product Patch §25.1 的五栏展示：你的数据、参考、Pawside 的判断（status + `allowed_claim`）、适用范围（`applicability_notes`）、来源。
- D 级证据标注"Pawside 的产品判断"。`not_assessable` 时，说明缺少哪些数据。
- **MUST** 整个浮层不调用 LLM。
- **验收**：S1 与 S4 各打开一次；浮层中的每一个字都能追溯到注册表或 facts。

### A6 行动行（维度 4 第一步）

- **NEW** 前端组件 `ActionRow`：左侧是 `next_actions[i].text`，右侧是按钮。按钮文字按固定映射，模型不能修改：

| action_type | 按钮 | 点击后 |
| --- | --- | --- |
| `log_meal` | 记一餐 | 打开记账页，按当前时间预选餐次 |
| `complete_record` | 补记录 | 直接定位到缺数据的那一组或那一餐 |
| `view_next_session` | 看下次训练 | 打开下一次训练详情，高亮相关动作 |
| `add_recovery_checkin` | 记录状态 | 直接弹出恢复自评 |
| `none` | 无按钮 | 只显示文案 |

- 第一条用实心按钮，第二条用文字链接。
- 每行提供"不需要"（D11）。
- **完成状态**：用户回到来源页时，由规则判断动作是否完成，完成的行变灰并打勾（D12，不重新生成）。判定规则：

| action_type | 判定为完成的条件 |
| --- | --- |
| `log_meal` | 建议发出之后，新增了一条饮食记录 |
| `complete_record` | 目标记录的缺失字段已被补齐 |
| `view_next_session` | 打开过下一次训练的详情 |
| `add_recovery_checkin` | 当天有了恢复自评 |

- **NEW** 表 `coach_action_events`（`id`、`user_id`、`generation_id`、`surface`、`action_index`、`action_type`、`status: shown|clicked|done|dismissed`、`created_at`、`updated_at`），开启 RLS，用户只能读写自己的行。它同时为 A4 的上周回顾和 D11 的忽略提供数据。
- 为 `complete_record` 预填定位信息：规则在 `allowed_actions` 旁同时给出 `action_targets`，例如 `{ "complete_record": { "kind": "set", "exercise_log_id": "..." } }`。它不经过模型，由前端直接使用。

### A7 小黑猫提醒（维度 1，D4、D5、D24）

- **NEW** 前端组件 `CoachCat`：固定在屏幕侧边，有两种状态："安静"和"有气泡"。
- **触发**（仅首批三种）：周报生成、双周身体变化生成（B6 之后才有）、有待确认的调整卡（阶段 C 之后才有）。阶段 A 实际只会触发周报。
- **规则**：
  - 一天最多一个气泡，可以点掉；点气泡跳到对应内容。
  - 气泡文案用固定模板，不调用 LLM。例如"hi，你的周报好啦"。
  - 训练进行中隐藏；系统开启"减少动态效果"时不播放动画。
- **NEW** 表或本地状态：`coach_nudges`（`user_id`、`kind`、`ref_id`、`shown_at`、`dismissed_at`），用于实现"每天最多一个"。
- **预留**：点击小猫本身打开 Chat（将来实现）；现在点击只展开最近一条提醒。
- 视觉素材由设计提供；素材到位前先用占位图形。

---

## 6. 阶段 B：上下文

完成标志：在 S6 下，周报能说出跨天模式，训练反馈能对比上一次同 split。

### B1 Coach State Snapshot（维度 3）

- **NEW** `lib/coach/snapshot.ts#buildCoachSnapshot(userId, date): CoachSnapshot`。确定性、无副作用、可单测：同样的数据库状态永远得到同样的结果。
- **输出**是一组 `MetricFact`（沿用现有类型）加少量结构化上下文，总量约 20–40 个 facts：

| 块 | 内容 | 来源（**VERIFY**） |
| --- | --- | --- |
| 用户 | 目标、训练经验、`profile.available_minutes` | `user_profiles`、`onboarding_capability_profiles` |
| Method | 当前 Method、cycle、下一次 split 与日期、本周计划练数、已完成练数 | `method_enrollments`、`method_cycles`、`session_prescriptions` |
| 近 7 天 | 训练次数、恢复自评均值、记录完整天数（**不含**蛋白达标天数） | `workout_logs`、`recovery_checkins`、`user_food_logs` |
| 上周重点 | 上周 `next_actions` 及完成情况 | `ai_generated_content`（weekly）、`coach_action_events` |
| 身体（双周） | 体重 7 日均值的前后对比、围度、体脂（有记录时）；14 天内称重少于 4 次记为 `not_assessable`；预留 `body.photo_checkpoints: []` | `body_metrics` |
| 数据完整度 | 各域的 `complete / partial / unknown` | 由以上各项汇总 |

- 各节点按需取用：

| 节点 | 使用的块 |
| --- | --- |
| 餐后 | 用户 |
| 日报 | 用户、Method |
| 训练前 / 训练后 | 用户、Method、近 7 天 |
| 周报 | 全部（身体块只在双周使用） |

- **MUST** 趋势类数字全部由 snapshot 计算，模型不自己算。

### B2 关系信号与主焦点（维度 2）

- **NEW** `lib/coach/relations.ts`，输出 `InterpretedSignal`（`domain` 取值为 **NEW** `cross_domain`；`authority` 形如 `Pawside heuristic §relations`，以便通过绑定闸门）。

| key | 成立条件（全部由规则判断） | 用于哪些节点 |
| --- | --- | --- |
| `stall_with_low_fuel` | 同一动作连续 2 次没有达到处方下限，**且**这段时间热量或蛋白的日均值低于目标 | 训练后、周报 |
| `adherence_vs_duration` | 本周完成练数 < 计划练数，**且**实际训练时长超过 `profile.available_minutes` 20% 以上（**DEFAULT** 阈值） | 周报、训练前 |
| `fatigue_before_load` | 最近一次恢复自评 ≤ 2（满分 5），**且**下一练的处方总组数高于该用户的平均水平，或近 3 次训练时长高于平时 | 训练前、日报的"明天"部分 |

- 关键数据不全时，对应关系一律 `not_assessable`，不进入排序。
- `stall_with_low_fuel` 依赖 B6 的"处方 vs 实际"facts，要在 B6 之后才能真正成立；在那之前，它总是 `not_assessable`。
- **NEW** `rankSignals(signals)`，按 D7 排序：
  1. 安全：`safety` / Guardrail 相关
  2. 坚持：完成度、跳练
  3. 训练执行：处方完成情况
  4. 热量
  5. 蛋白等宏量营养
  6. 细节
  成立的关系信号排在它所属的最高一类之前。
- prompt 要求：第一句回答"现在最重要的是什么"；不逐条复述 facts；涉及因果时只能引用关系信号；默认选 `ranked_signals[0]`，不选它时必须在 `why_now` 中说明理由。
- 在 Evidence Registry 中新增一条 D 级条目，记录"训练优先于营养"的产品判断，以及 3 条关系的依据链接。
- **验收**：S1 的第一句要涉及两个领域；S4 的主焦点是补记录。

### B3 连续性接线（维度 5）

按节点传入的内容：

| 节点 | 传入 | **MUST NOT** 传入 |
| --- | --- | --- |
| 餐后 | 只看当天 | 前几天的摄入 |
| 日报 | Method 位置 | 前一天的缺口；前一天的建议是否做到 |
| 训练前简报 | 上一次同 split 的表现；本周进度 | 前一天的饮食 |
| 训练后 | 上一次同 split 中同一动作的表现 | — |
| 周报 | 本周逐日数据表；上周重点及是否做到；Method 执行度 | 逐日的补偿计算 |

- 输出检查中加入跨天补偿词表（"补回""弥补昨天""明天多吃"等），日报和餐后命中即重试。

### B4 训练前简报（维度 6，D17）

- **NEW** surface `session_brief`（prompt `openai_session_brief_v1`），在训练开始页生成。`ai_generations.surface` 的约束要加上这个值。
- **输入**：今天的处方（动作、组数、次数区间、重量）、上一次同 split 的执行摘要、今天的恢复自评、`profile.available_minutes`、关系信号 `fatigue_before_load` / `adherence_vs_duration`。
- **输出**：`coach_output_v1`，其中 `headline` 是今天的重点；只有在有变化时，才给出 1 条动作级的 `evidence`。
- **缓存**：以 `session_prescription_id` 加输入的 `input_snapshot_id` 为键，输入不变就不重新生成。
- **验收**：S5 下，简报的重点会根据恢复情况变化；读完不超过 3 秒。

### B5 训练中规则提示（维度 6，D18）

- **MUST** 不调用 LLM。提示是模板文案，在记录一组之后由客户端或服务端规则即时触发。
- **首批 4 条规则（DEFAULT）**：

| # | 触发条件 | 提示文案（模板） |
| --- | --- | --- |
| R1 | 这一组的实际次数低于处方下限 | 这组低于目标次数，下一组保持这个重量。 |
| R2 | 到目前为止的每组都达到处方上限 | 这组做满了，按处方继续，下次训练会评估加重。 |
| R3 | 完成了一组，但没有填次数或重量 | 记一下这组的次数和重量。 |
| R4 | 已用时长超过 `available_minutes` 15 分钟以上 | 已超出你设定的时长，剩下的可以照常做完，也可以提前结束。 |

- 每个动作最多出现 1 条提示；R4 每次训练最多 1 次。

### B6 训练后：处方 vs 实际；周报：逐日数据与双周身体（维度 6、8）

- **训练后新增 facts**（**NEW**，来自 `session_prescriptions` / `exercise_prescriptions` / `set_prescriptions` 与实际记录，**VERIFY** 字段名）：
  - `training.prescribed_exercise_count`、`training.skipped_exercises`（文本列表）
  - 每个动作：`completed_sets / prescribed_sets`、reps 是否落在区间内、是否缺 RIR
  - 与上一次同 split 同一动作的对比：reps 变化、重量变化
- **MUST** 训练后反馈要点名到一个具体动作的偏差或进步。
- **周报逐日数据表**：**NEW** `buildWeeklyDailyTable(userId, weekStart)`，每天一行，包含热量和蛋白的摄入与目标、各餐分布、训练的处方与实际（按动作汇总）、恢复自评、记录完整度。一周约 100–200 个值，不含原始日志。
- **模式核对**：模型输出的每条 `patterns` 都带 `days[]` 和 `metric_keys[]`。服务端逐天核对所列日期上的数据是否真的满足该模式，并且天数 ≥ 3（D16）。**NEW** 核对函数 `verifyPattern(pattern, dailyTable)`：
  - 描述中的方向（高于 / 低于目标、缺失等）要能在每个所列日期上成立；
  - 不通过的模式直接剔除，不展示，并记入日志。
- **双周身体变化**：每隔一周（按 D23 的起始日计算），`body_change` 读取 snapshot 的身体块。最多 1 条，只描述方向和幅度，并和同期的训练、营养执行情况一起说。**MUST** 不下体脂或健康结论。
- **验收**：附录 A 的 W4；T1 中标 Ⓑ 的内容。

---

## 7. 阶段 C：新能力

完成标志：一条经用户确认的调整，出现在下一次训练里。

### C1 Proposal 数据模型与 API（维度 4 第二步）

- **NEW** 表 `coach_proposals`：
  - `id`、`user_id`、`source_surface`、`generation_id`
  - `target_type`（`next_session`）、`target_id`（`session_prescription_id`）
  - `candidates jsonb`：规则给出的 1–2 个完整方案（D13），每个方案包含 `candidate_id`、`policy_id`、`changes[]`、`before` / `after` 摘要
  - `chosen_candidate_id`（模型的选择）、`rationale`（模型文案，经 A0-1 检查）
  - `status`：`pending | applied | rejected | expired`
  - `applied_at`、`reverted_at`、`created_at`
  - 开启 RLS。
- **NEW** 表 `prescription_change_log`：记录每次写入前后的处方快照，用于撤销和追溯。
- **API**：
  - `GET /api/coach/proposals?status=pending`
  - `POST /api/coach/proposals/:id/apply`：policy 重新校验 → 写入处方 → 写变更记录 → 状态改为 `applied`
  - `POST /api/coach/proposals/:id/reject`
  - `POST /api/coach/proposals/:id/revert`：只在下一次训练开始前可用
- **MUST**：
  - 同一用户同一时间最多 1 条 `pending`；
  - 下一次训练开始后自动变为 `expired`；
  - 模型只能返回 `chosen_candidate_id`，不能返回任何数值；
  - apply 时必须重新跑 policy 校验，失败就拒绝写入。

### C2 进阶引擎（维度 10，D28、D30）

- **NEW** `lib/coach/progression.ts#evaluateProgression(exerciseId, recentSessions)` → `progress | hold | regress | insufficient_data`，结果写入 `user_exercise_progression`（**VERIFY** 现有列，缺什么补什么）。
- **double progression 规则**：
  - 最近一次同一动作的**所有组**都达到处方次数区间的上限 → `progress`：下次重量加一个最小增量（杠铃 2.5 kg；哑铃加到下一档；器械加到下一档）。增量表为 **NEW** 配置项。
  - 连续 2 次有组低于区间下限 → `hold`；连续 3 次 → `regress`（退回上一个重量）。`regress` 的次数为 **DEFAULT**，可调。
  - 缺少组数、次数或重量 → `insufficient_data`，不产生候选。
- `progress` / `regress` 生成 Proposal 候选，在训练后反馈中出现调整卡，例如："下次卧推 60 → 62.5 kg。上次三组都做满了 10 次。"
- **MUST**：
  - 纯函数，全覆盖单测；
  - 动作之间平等，不设保护名单（D30）；
  - 只改重量，不改动作组成。

### C3 恢复引擎（维度 10，D29、D30）

- **NEW** `lib/coach/recovery.ts#decideRecoveryAdjustment(checkin, nextSession, snapshot)`，从 4 档中选一档：

| 档位 | 对处方的改动 |
| --- | --- |
| 保持 | 不改 |
| 每个动作减一组 | 每个动作的组数减 1，最少保留 1 组 |
| 缩短到 45 分钟版 | 所有动作按比例减组，使预计时长 ≤ 45 分钟；**不删动作** |
| 顺延一天 | 下一次训练日期推后 1 天 |

- **DEFAULT 触发规则**：
  - 恢复自评 ≤ 2（满分 5）→ 每个动作减一组；
  - ≤ 2 且 `fatigue_before_load` 成立 → 给出 2 个方案："每个动作减一组"与"顺延一天"；
  - 可用时长不够 → 缩短到 45 分钟版；
  - 其他情况 → 保持，不生成 Proposal。
- 产出 Proposal 后，调整卡出现在训练前简报中。

### C4 调整卡 UI（维度 4 第二步）

- **NEW** 组件 `AdjustmentCard`，放在训练后反馈、训练前简报和周报中。
- **内容**：标题"下次训练建议调整" → 变化前后对比（例如"60 分钟 → 45 分钟；每个动作 4 组 → 3 组"）→ 一句理由 → "为什么？"。
- 有 2 个方案时二选一；按钮是"应用"和"保持原计划"，两者分量一样。
- **应用后**：下一次训练页顶部显示"已按建议调整 · 撤销"。
- 有 `pending` 的调整卡时，触发小猫气泡（A7）。

### C5 未接入的 interpretation 规则

- 逐条评估 `interpretWeeklyAerobic`、`interpretStrengthFrequency`、`interpretHypertrophyVolume`、`interpretProteinTarget`、`interpretCalorieSafety`、`interpretEnergyAvailability`。
- 输入数据齐全才接入 Composer，不齐全的继续保持 `not_assessable`。**MUST** 不为了"让 AI 更聪明"而补造输入。
- 每接入一条，在 PR 中写明它的数据来源。

---

## 8. 数据库变更汇总

| 阶段 | 变更 | 说明 |
| --- | --- | --- |
| A0 | NEW `ai_generations` | 生成日志，含 Chat 预留字段，保留 90 天 |
| A4 | `ai_generated_content.content_type` 增加 `weekly_review_ai` | **VERIFY** 现有 check 约束 |
| A6 | NEW `coach_action_events` | 行动行的展示、点击、完成、忽略 |
| A7 | NEW `coach_nudges` | 小猫提醒的频率控制 |
| A2 | NEW 用户设置 `planned_meals`（默认 3） | 可以先不做 UI |
| B4 | `ai_generations.surface` 增加 `session_brief` | 以及 prompt 版本常量 |
| C1 | NEW `coach_proposals`、`prescription_change_log` | |
| C2 | `user_exercise_progression` 按需补列 | **VERIFY** 现有结构 |
| 全部 | 新表一律开启 RLS 并显式 grant | 不要像 `ai_feedback` 那样依赖项目默认权限 |

---

## 9. 验收方式

- **场景**：共用的 S1–S6，加上各节点专属的 M1–M5、T1–T5、W1–W5（见附录 A）。每种场景从内测用户的真实记录中挑一天。
- **每个 PR 的验收**：在对应场景下各生成一次，与附录 A 对照，并在 PR 描述中贴出实际输出。
- **代码检查**（每次生成都跑，失败即重试一次）：
  - 字段齐全，长度不超限；
  - 没有裸数字，占位符都能解析；
  - `action_type` 在 `allowed_actions` 之内；
  - `not_assessable` 没有被写成判断；
  - 没有命中禁用表述；
  - 餐后建议量不超过每餐上限；
  - 周报模式通过逐天核对且满 3 天。
- **人工检查**（产品实测）：
  - 第一句回答了"现在最重要的是什么"；
  - 读完就知道下一步做什么；
  - 语气简洁、不说教、不制造压力；
  - 没有跨天补偿的说法。
- **单元测试**：`output-checks`、`snapshot`、`relations`、`rankSignals`、`verifyPattern`、`progression`、`recovery`、Proposal 的 apply / revert，全部要有。另外补上 composer 七个分支的集成测试（用 fetch stub）。

---

## 10. Chat 入口预留（本期不实现）

- 每个节点都是一个"能力"：输入固定，输出 `coach_output_v1`。在 **NEW** `lib/ai/capabilities.ts` 中登记（上一轮已给骨架），并保持 CI 不变量：**只有 `create_proposal` 有副作用**。
- 三个对应关系：
  - Snapshot（B1）就是 Chat 的记忆；
  - `WhySheet`（A5）的数据源就是 `explain_signal` 工具；
  - Proposal（C1）是 Chat 唯一的写入口。
- `ai_generations` 的 `trace_id` / `invoked_by = 'orchestrator'` 已经预留。
- 点击小猫将来打开 Chat。

---

## 11. 已知风险

| 风险 | 缓解办法 |
| --- | --- |
| 处方相关表的真实字段与本文假设不一致 | 所有 **VERIFY** 项先核实；B6 和阶段 C 开工前，先提交一份字段映射 |
| 占位符模式下模型不稳定，比如忘记写占位符 | A0-2 带反馈重试 1 次；prompt 中给 2 个正反例 |
| 单人数据太少，关系信号长期不成立 | 这是预期结果；不成立时按 `rankSignals` 选主焦点，不降低阈值 |
| 小猫打扰用户 | 严格执行每天最多 1 个气泡，只有三种触发 |
| Method 起始日取不到 | 退回周一，并在 UI 中标注周的范围 |

---

## 附录 A：理想输出样例（验收基准）

样例中的数字是渲染后的样子，模型实际输出的是占位符。标 Ⓑ 的内容依赖阶段 B。"【…】"表示行动行上的按钮。

### A.1 Home Coach Card（每日复盘）

| 状态 | 输入要点 | 理想输出 | 不应出现 |
| --- | --- | --- | --- |
| S1 完整训练日 | 腿日已完成；蛋白 105 / 130 g；明天休息 | **标题**：腿日按处方完成，蛋白比目标少 25 g。**依据**：深蹲 4 组都在 6–8 次区间内 Ⓑ **下一步**：明天休息，下一练是周五的 Push【看下次训练】 | "明天要把 25 g 补回来" |
| S2 休息日 | 计划内休息；热量 1,950 / 2,000 kcal；蛋白 128 / 130 g | **标题**：计划内的休息日，热量和蛋白都在目标附近。**下一步**：明天是 Pull【看下次训练】 | "今天没有训练记录" |
| S3 当天进行中 | 已记 2 餐；热量还剩 800 kcal、蛋白还剩 50 g | **标题**：今天已记 2 餐，还剩 800 kcal、蛋白 50 g。**下一步**：晚餐安排一份高蛋白主菜【记一餐】 | "摄入不足" |
| S4 记录不全 | 卧推没记组数；训练量 not_assessable | **标题**：卧推没记组数，这次训练量暂时算不了。**下一步**：补上卧推的组数【补记录】**数据提示**：补全之后能看到和上次的对比 | 对训练量的任何判断 |
| S5 恢复差 | 自评"很累"；明天是腿日 | **标题**：今天自评恢复偏差，明天是腿日。**下一步**：明天练前再记一次状态【记录状态】 | "你训练过度""明天别练" |
| AI 失败 | — | 标签"基础总结"：今天记录了 1 次训练、3 餐。AI 复盘暂时不可用。【重试】 | 长得像 AI 复盘的降级文案 |

S1 的模型原始输出：

```json
{
  "headline": "腿日按处方完成，蛋白比目标少 {{nutrition.protein_remaining}}。",
  "primary_focus": { "signal_keys": ["nutrition.protein"], "why_now": "训练已完成，唯一偏离目标的是蛋白" },
  "evidence": [
    { "text": "完成 {{training.completed_exercise_count}} 个动作，用时 {{training.duration_minutes}}", "signal_key": "training.session_duration", "status": "within_reference", "evidence_ref_ids": ["E-SESSION-001"] }
  ],
  "next_actions": [
    { "text": "明天休息，下一练是周五的 Push", "action_type": "view_next_session", "basis": "method" }
  ],
  "data_quality_tip": null,
  "safety": { "level": "none", "text": null, "evidence_ref_ids": [] }
}
```

### A.2 餐后反馈

| 状态 | 输入要点 | 理想输出 | 不应出现 |
| --- | --- | --- | --- |
| M1 训练日，午餐后 | 当天有训练；蛋白还剩 70 g；每餐参考 43 g | **标题**：这餐之后，蛋白还剩 70 g。**下一步**：晚餐多安排一份高蛋白主菜，比如鱼或鸡胸【记一餐】 | 换算成克数的食物量（§26） |
| M2 早餐后 | 已记 1 餐；还剩 1,500 kcal、蛋白 100 g | **标题**：早餐记好了，后面几餐按正常节奏分配就行。**下一步**：无按钮 | "还差很多""不足" |
| M3 午餐吃得很少 | 蛋白还剩 110 g；每餐参考 43 g，上限约 65 g | **标题**：蛋白还剩 110 g，晚餐补到大约 65 g 就够了。**下一步**：晚餐安排两份蛋白来源，剩下的不用追【记一餐】 | 要求晚餐补足全部 110 g |
| M4 可能漏记 | 这餐只记了米饭，热量明显偏低 | **标题**：这餐只记了米饭，配菜可能漏记了。**下一步**：补上这餐的其他食物【补记录】 | 按只吃了米饭来给建议 |
| M5 已超出目标 | 热量 2,300 / 2,000 kcal | **标题**：今天热量已超出目标 300 kcal。**下一步**：无按钮 | "不健康""明天少吃一点" |

M3 的模型原始输出：

```json
{
  "headline": "蛋白还剩 {{nutrition.protein_remaining}}，晚餐补到大约 {{nutrition.protein_meal_cap}} 就够了。",
  "primary_focus": { "signal_keys": ["nutrition.protein"], "why_now": "当天剩余量超过一餐能吃下的量" },
  "evidence": [],
  "next_actions": [
    { "text": "晚餐安排两份蛋白来源，剩下的不用追", "action_type": "log_meal", "basis": "rule" }
  ],
  "data_quality_tip": null,
  "safety": { "level": "none", "text": null, "evidence_ref_ids": [] }
}
```

M5 需要 **NEW** fact `nutrition.calories_over_target`（仅在超出时产出）。

### A.3 训练后反馈

| 状态 | 输入要点 | 理想输出 | 不应出现 |
| --- | --- | --- | --- |
| T1 完整完成 | Pull 日 5 / 5 个动作，记录完整，52 分钟 | **标题**：Pull 日 5 个动作全部完成，用时 52 分钟。**依据**：划船比上次多做了 2 次 Ⓑ **下一步**：下一练是周五的 Legs【看下次训练】 | "做得很棒，继续保持！"这类空话 |
| T2 跳过动作 | 完成 4 / 5，面拉没有记录 | **标题**：完成了 5 个动作中的 4 个，面拉没有记录。**下一步**：如果做了，补上面拉的组数【补记录】 | "你跳过了动作"（可能只是漏记） |
| T3 训练超时 | 用时 95 分钟，设定的可用时长 60 分钟 | **标题**：这次用了 95 分钟，比你设定的 60 分钟长。**下一步**：看看下次训练的安排【看下次训练】 | "训练时间太长了"（带评价） |
| T4 缺组数 | 2 个动作没有组数；训练量 not_assessable | **标题**：有 2 个动作没记组数，这次的训练量算不了。**下一步**：补上缺的组数【补记录】 | 对训练量的任何判断 |
| T5 练完很累 | 训练后自评 1 / 5 | **标题**：练完了，自评恢复偏低。**下一步**：下次练前再记一次状态【记录状态】 | "过度训练""训练量必须降低 X%" |

T3 的模型原始输出：

```json
{
  "headline": "这次用了 {{training.session_duration}}，比你设定的 {{profile.available_minutes}} 长。",
  "primary_focus": { "signal_keys": ["training.session_duration"], "why_now": "动作都完成了，唯一偏离设定的是时长" },
  "evidence": [
    { "text": "完成 {{training.completed_set_count}} 组，记录完整", "signal_key": "training.completed_set_count", "status": "within_reference", "evidence_ref_ids": [] }
  ],
  "next_actions": [
    { "text": "看看下次训练的安排", "action_type": "view_next_session", "basis": "method" }
  ],
  "data_quality_tip": null,
  "safety": { "level": "none", "text": null, "evidence_ref_ids": [] }
}
```

阶段 C 上线后，T3 会多一张调整卡："下次改用 60 分钟版？"

### A.4 周报

专属字段：

```json
{
  "patterns": [
    { "text": "≤80 字", "days": ["2026-09-21"], "metric_keys": ["nutrition.protein_consumed"], "evidence_ref_ids": [] }
  ],
  "last_week_review": { "text": "≤60 字", "done": 2, "total": 3 },
  "body_change": { "text": "≤80 字", "metric_keys": ["body.weight_rolling_7d"] }
}
```

`done` / `total` 由规则填写；`last_week_review` 第一周为 `null`；`body_change` 只在双周出现，其余为 `null`。

| 状态 | 输入要点 | 理想输出 | 不应出现 |
| --- | --- | --- | --- |
| W1 完整的一周 | 3 / 3 练完成；5 天有饮食记录，其中 4 天蛋白未达标 | **标题**：计划的 3 练全部完成，蛋白是本周唯一反复出现的问题。**模式**：有记录的 5 天里，4 天蛋白未达标，缺口都在训练日的晚餐（周一、周三、周四、周六）**上周重点**："每次训练都记 RIR"，3 次中 2 次做到 **下周重点**：训练日晚餐固定一份高蛋白主菜；补记周二的组数【补记录】 | 复述 Dashboard 上的每日数字 |
| W2 记录太少 | 只有 2 天有记录 | **标题**：本周只有 2 天有记录，还看不出规律。**模式**：无 **下周重点**：每天至少记一餐【记一餐】 | 从 2 天数据里硬挖出模式 |
| W3 完成度低 | 1 / 3 练完成；两次训练都超过了设定的 60 分钟 | **标题**：本周完成 1 / 3 练，两次训练都超出了设定的 60 分钟。**下周重点**：先把 3 练安排进日程【看下次训练】 | "你不够坚持" |
| W4 双周节点 | 体重 7 日均值：70.4 → 69.8 kg；称重 9 次；6 / 6 练完成 | （在 W1 的内容之外增加）**身体变化**：两周内体重 7 日均值从 70.4 降到 69.8 kg，这两周训练 6 / 6 练完成。 | "减脂成功"（注册表禁用）、体脂率估算 |
| W5 第一周 | 没有上周重点 | `last_week_review` 为 `null`，不显示这一块。其余同 W1 或 W2。 | "上周你……"这类编出来的回顾 |

---

## 附录 B：事实来源与参考

- 设计评审文档与样例（Claude Docs）：《Pawside AI 功能逐项设计评审》，含"阶段 A 输出样例"标签页。
- 代码审计：`ai-surface-audit.md`、`ai-full-reference.md`（2026-09-26）。
- 评估方法：[Anthropic：如何建立测试用例](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests)
- 主焦点优先级：[Helms 训练金字塔](https://grantbarnett.wordpress.com/2016/03/07/the-muscle-and-strength-pyramid/)、[Helms 营养金字塔](https://counsellingharbour.com/muscle-and-strength-pyramid-nutrition-review/)、[ACSM 2026 抗阻训练指南](https://acsm.org/resistance-training-guidelines-update-2026/)
- 关系信号：[平台期诊断框架](https://www.thebodybuildingdietitians.com/blog/why-progress-stalls-a-framework-for-identifying-training-and-nutrition-plateaus)
- 每餐参考量：[Schoenfeld & Aragon 2018](https://pubmed.ncbi.nlm.nih.gov/29497353/)、[Trommelen et al. 2023](https://cris.maastrichtuniversity.nl/en/publications/the-anabolic-response-to-protein-ingestion-during-recovery-from-e/)
- 加重幅度：[ACSM 2009 Progression Models](https://tourniquets.org/wp-content/uploads/PDFs/ACSM-Progression-models-in-resistance-training-for-healthy-adults-2009.pdf)
