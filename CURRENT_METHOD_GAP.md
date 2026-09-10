# Pawside 2.0 Phase 0｜Current Method Gap

> 审计日期：2026-09-09  
> 审计分支：`feature/method-guidance-v1`  
> 基线提交：`da1894a6c40b63af18754282cf13acaeb526a487`  
> 范围：只审计 `D:\Pawside`。Morrow 不在本次范围内，未检查、未合并、未修改。  
> 本文件描述的是当前工作树的真实状态，不把 PRD、migration 文件、测试声明或旧报告单独视为已上线功能。

## 1. 结论

当前 Pawside 是一套可运行的健身记录与复盘应用，并已经具备一层**未激活的 Method 数据骨架**；它还不是一套可执行的 Method 系统。

当前真实主流程仍然是：

```text
用户登录
→ 完成基础资料
→ Home 显示 Method 尚未开放
→ 用户进入“记录训练 / 自由训练”
→ 自己选择训练类型、填写动作/组/次数/重量
→ 写入 workout_logs.exercises JSON
→ Home / History / Weekly / AI Daily Review 消费这条日志
```

仓库里虽然已有 `/api/method/current`、`/api/training/today`、`session_prescriptions` 等名字，但没有 Canonical importer、不可变 Method Release、完整三分化规则、Enrollment 初始化、逐组 Actual、Calibration、Progression、Recovery 或 Adaptive Coaching 闭环。`/training/today` 目前只是“读取并展示一条已存在处方”的页面；没有创建处方、开始训练、逐组保存或完成训练的写入链路。

因此当前判定：

| 层 | 状态 | 结论 |
|---|---|---|
| 现有 Journal（训练/饮食/身体/历史/周报/AI） | `KEEP + REWORK` | 可复用，但仍围绕 legacy JSON 日志运行 |
| Method schema 骨架 | `PARTIAL` | 有表和 draft seed，没有 Release/Importer/Evidence 治理 |
| Method 可见体验 | `NO_GO` | Home 只有 unavailable 卡片；无 Method Overview |
| Today Prescription | `NO_GO` | 只有 read endpoint，无生成和执行闭环 |
| Guidance / Warm-up | `NO_GO` | Workbook 有内容，运行时数据库和 UI 未接入 |
| Calibration / Progression | `NO_GO` | 只有空表结构，没有引擎、事件和真实写入 |
| Recovery / Adaptive Coaching | `NO_GO` | 当前表、API、UI、规则执行均不存在 |
| Active Method Release | `BLOCKED` | 既有工程缺口，也有两项 Canonical 核心证据 blocker |
| Phase 1 基础设施开发 | `READY_FOR_CONFIRMATION` | 可在本分支开始，但只应产出 draft/blocked release，不应激活 |

## 2. 审计边界与证据等级

### 2.1 分支与工作树

- 已从当前基线创建并切换到 `feature/method-guidance-v1`。
- 基线提交与 `master` 当前提交相同：`da1894a...`。
- 创建分支前已有大量未提交 Pawside 激活工作，包括 Supabase migrations、OpenAI-only、Method 空状态接口、训练素材等。本轮没有 reset、stash、覆盖或删除这些修改。
- 因此后续实现必须继续区分：
  - 已提交基线；
  - 当前工作树已有修改；
  - 本 Method 分支新增修改。

### 2.2 Source of Truth

冲突时采用以下顺序：

```text
产品行为：PRD Patch v0.3 > Overview PRD v0.1
系统架构：Spec Patch v0.4 > System Spec v0.1
方法规则：Canonical Workbook v1.1
证据解释：原始 transcript / 官方视频
当前能力：当前仓库真实代码与 migration
```

| 资产 | 实际文件 | SHA-256 / 状态 |
|---|---|---|
| Overview PRD | `Pawside_2.0_Overview_PRD_全模块产品PRD_v0.1.md` | `1496F370...FE733D`，2,998 行，已完整读取 |
| System Spec | `Pawside_2.0_System_Spec_v0.1.md` | `954611E1...69003`，3,646 行，已完整读取 |
| PRD Patch | `Pawside_2.0_PRD_PATCH_Method_Knowledge_Adaptive_Coaching_v0.3.md` | `DA7D...655D3`，1,214 行，已完整读取 |
| Spec Patch | `Pawside_2.0_SPEC_PATCH_Method_Knowledge_Canonical_Workbook_v0.4 (1).md` | `A28B...C030E`，2,203 行，已完整读取 |
| Canonical Workbook | `Pawside_三分化_Canonical_Method_Workbook_v1.1.xlsx` | `FDB979D8...5F7BA9`，19 sheets，已只读解析 |
| 原始 transcript | 未随本次附件提供，Downloads 中也未定位到对应文件 | `MISSING_SOURCE_ASSET` |

现有 migration 内写有一个原始 txt 文件名和 SHA-256，但当前没有对应文件字节可核验。它只能算“历史元数据声明”，不能替代 L0 Source，也不能支持 RAG ingestion 或证据重放。

### 2.3 当前数据库证据边界

- 仓库 migrations 可重建 27 张表，属于 `migration-confirmed`。
- 仓库中的 2026-09-08 激活报告记录：六个 migrations 已推送到 `sbwevlhzqujrtucppacl`，SQL contracts 与 Advisors 当时通过。
- 本次 Phase 0 没有执行写库或重新跑远端 SQL contract；因此远端状态属于“最近一次已记录证据”，不是本次重新证明。
- Method 相关结论以当前 migration、API 和 UI 实现为准，不因远端存在空表而提升为产品可用。

## 3. Canonical Workbook 审计

### 3.0 2026-09-09 P0 Resolution Patch 增量结论

新收到的 `Pawside_2.0_METHOD_P0_RESOLUTION_PATCH_v0.1` 不会把缺失的原方法数字伪装成 Method Truth。它把原来的单一发布 blocker 拆成：

- `blocks_v1_runtime_release`：Q-001、Q-004 均已解除；允许使用明确标注的、版本化的 `product_execution_default`。
- `blocks_strict_method_release`：两项仍为 true；继续等待可重放的原始 transcript 或更完整官方画面/字幕。

因此本文后续“Q-001/Q-004 阻塞 active”的旧表述，应理解为阻塞 **Strict Method Certification**，不再阻塞 V1 Runtime 的本地开发与 Internal/Beta 验证。Production activation 仍因完整训练闭环未实现而保持 HOLD。

Workbook 的 19 张表和 Spec Patch 注册表一致。它明确规定：生产 Runtime 不直接读取 xlsx；必须走 `validation → diff → draft release → tests → explicit activate`。

### 3.1 可导入与非运行时资产

| 类别 | Sheets | 当前用途 |
|---|---|---|
| Runtime Canonical | `02`, `03`, `04`, `05`, `12`, `13`, `14` | 方法原则、计划、动作 Guidance、递进、校准、适应策略、证据绑定 |
| 条件式生成 | `10` | 枚举/中文词典，可生成代码常量或校验 schema |
| 工程契约 | `15`, `16`, `17` | RAG、数据库映射、Importer 唯一契约；不导入成方法规则 |
| Release Gate | `09`, `18` | 只供 validator 判断 blocker，不作为 Runtime truth |
| QA Fixture | `06`, `07`, `08` | 自动化/验收 fixture，不写入生产规则 |
| 治理/历史 | `00`, `01`, `11` | 使用说明、旧字段验证历史、Source Registry |

### 3.2 数据完整度

| Sheet | 行级结果 | 审计判断 |
|---|---:|---|
| `02_方法论总览` | 13/13 生效 | 方法级原则可进入 draft release |
| `03_计划结构` | 9 生效，6 待补证据 | Push + 大部分 Pull 可建模；Day2 弯举和 Day3 仍不能形成完整可执行处方 |
| `04_动作执行库` | 10 生效，5 待补证据 | 可先导入文字 Guidance；缺口必须 nullable/inactive |
| `05_递进规则` | 21 生效，1 待补证据 | 单动作多数状态机可导入；约 1 月微调不能自动执行 |
| `12_重量校准规则` | 8 生效，1 待确认 | Calibration 主链可建；“连续偏轻”阈值不能写死 |
| `13_适应场景矩阵` | 20 生效，1 待确认 | 大部分偏差场景可进入独立 policy release |
| `14_规则证据索引` | 64 evidence rows；45 已定位、15 产品已确认、2 部分定位、1 待补证据、1 待确认 | 结构足够做证据关系，但 L0 transcript 缺失使原文 chunk 仍不可重放 |
| `09_视频待核验` | 9 已解决，1 部分解决且阻塞 | V009 仍阻塞 Day3 精确处方 |
| `18_未决问题` | 3 已解决，8 未解决 | 其中 Q-001、Q-004 是当前两项 P0 核心 Method blocker |

### 3.3 当前发布阻塞项

1. `Q-001 / V009`：V1 Runtime 已通过产品执行默认解决；Strict Method Source 仍缺单腿硬拉、保加利亚分腿蹲精确组次，以及前蹲/RDL 的精确次数。山羊挺身 `3×8` 已按新 Patch 收口为 method explicit。
2. `Q-004`：V1 Runtime 使用 `3组(method_explicit) + 12–15次(product_execution_default) + calibration-only`；正式 reps/progression 仍是 Strict Source 缺口。
3. 原始 transcript 文件未提供：不能建立可校验的 source document/chunk，也不能证明 Workbook EvidenceID 能回到不可变原文。
4. Warm-up 已确定是 Split 级独立 Protocol，但三天完整动作/次数仍未全部结构化；它是部分范围 blocker，不应由 AI 补写。
5. `CAL-008 / SCN-018` 的连续偏轻阈值待 Beta 验证，必须作为 policy 配置保持关闭，不能假定 2 次或 3 次。

这些缺口不阻止 Phase 1 和 V1 Runtime 开发，也不阻止后续 Internal/Beta release；但仍阻止“100% Source-complete”的 Strict Method Certification。当前尚缺 Enrollment、Prescription、Actual 等运行闭环，所以 production active 仍不可宣称。

## 4. 当前 App 资产盘点

当前技术栈：Next.js 16.3.4 App Router、React 19、TypeScript strict、Supabase Auth/Postgres、OpenAI Responses API、Tailwind、Recharts。Next.js 16 使用根级 `proxy.ts`，当前实现已按这一约定迁移。

### 4.1 用户与业务模块

| 模块 | 当前真实能力 | 数据源/入口 | 对 Method 的判断 |
|---|---|---|---|
| Home / Dashboard | 今日训练次数、饮食餐数、旧 weekly target 完成度、日志 streak、AI 摘要、体重趋势、快捷入口；顶部有 Method unavailable/active 卡片 | `/home` 直接并行读 Supabase；另调 Daily Review 与 Method API | `KEEP + MAJOR REWORK`。底层仍以 legacy 日志和固定周目标为中心 |
| Workout | 自由选择训练类型；动作可选；按动作存 sets/reps/weight 汇总值；可编辑/删除 | `/workout`、`/workout/[id]/edit` → `workout_logs.exercises JSON` | `KEEP AS EXTRA/LEGACY`。不是 prescription-driven，也不是逐组 Actual |
| Today Training | 可读取一条已有处方，展示动作、组目标和 workout-guide 三帧素材 | `/training/today` + `GET /api/training/today` | `PARTIAL READ-ONLY PROTOTYPE`。没有生成、start、set save、finish、autosave |
| Food / Nutrition | 可查结构化食物库；新增餐最终仍写 `food_logs.foods JSON`；Home/Weekly 读 legacy food log | `/food`、food APIs、7 张 normalized food tables | `KEEP + REWORK`。参考库可复用，用户事实尚未切 normalized tables |
| Body | 体重、体脂、肌肉量、围度、自定义指标记录 | `/body-metrics` → `body_metrics` | `KEEP`。可作为 Outcome / Recovery 辅助输入 |
| Progress Photo | 当前仓库没有 route、bucket、upload、signed URL 或表 | 无 | `ABSENT`。用户要求“保留”，但当前 checkout 没有可保留实现，需要后续恢复/新建 |
| History | 按日聚合 workout/food/body；详情可编辑/删除 legacy 记录；显示 Review | `/history`、`/history/[date]` | `KEEP + REWORK`。缺 Prescription、Method、Recovery、Deviation 上下文 |
| Weekly | 训练次数/时长、食物热量、体重趋势；以自然周和旧目标计算百分比 | `/weekly` 或 `/api/weekly`，两套重复聚合 | `KEEP + REWORK`。不能把 `workout_count / weekly_target` 当 Method adherence |
| Review | OpenAI Daily Review + deterministic rules fallback；显式标记 `openai/rules/no_data`；只缓存真实 OpenAI 结果 | `/api/ai/daily-review`、`ai_generated_content` | `KEEP AS COMPOSER`。当前不读 Method/Prescription/Recovery/Progression |
| Onboarding | 目标、性别、身高、参考体重；通过 server API 保存 | `/onboarding` → `/api/onboarding` | `PARTIAL`。已符合极简字段，但不采能力画像、不创建 enrollment/cycle/prescription |
| Auth | 邮箱密码登录/注册、确认 callback、忘记/重置密码、Supabase SSR | `/auth*`、`proxy.ts` | `REUSE`。Method 不应复制认证逻辑 |
| Settings | Profile、目标、单位、旧 weekly/calorie target、导出、退出 | `/settings` | `KEEP + REWORK`。旧 target 仍可编辑，与最新 PRD 存在冲突 |
| Checklist | 没有正式 checklist engine/UI | 无 | `ABSENT` |
| Badge / Milestone | 没有 definition、event 或 UI | 无 | `ABSENT`；现有只有日志 streak |

### 4.2 页面与 API 资产

- 17 个 `page.tsx` 页面路由。
- 15 个 API route 文件，覆盖 AI、body、summary、export、food、method reads、onboarding、today training、weekly、legacy workout。
- Method 相关 API 只有：
  - `GET /api/method/current`
  - `GET /api/method/current/progress`
  - `GET /api/training/today`
- 缺少：
  - Method Overview API；
  - prescription generation；
  - session start/complete；
  - set-by-set Actual writes；
  - deviation/discomfort；
  - pause/resume；
  - calibration/progression/recovery/adaptation decision；
  - source/import/release/evidence governance surface。

## 5. 当前数据库资产

### 5.1 Migration-confirmed 27 张表

```text
Journal / Auth profile
  user_profiles
  workout_logs
  food_logs
  body_metrics
  weekly_summary
  ai_plans
  ai_generated_content

Normalized nutrition
  foods
  food_aliases
  food_nutrition
  food_portion_templates
  user_food_logs
  user_food_log_items
  daily_nutrition_summary

Method reference / draft structure
  methods
  method_splits
  exercises
  exercise_media
  exercise_external_mappings
  method_rules
  method_split_exercises

Method user/prescription skeleton
  method_enrollments
  method_cycles
  user_exercise_progression
  session_prescriptions
  exercise_prescriptions
  set_prescriptions
```

### 5.2 现有 Method 数据形态

- `methods` 同时承担 identity、version、status，只有一个 `1.0 / draft` 官方三分化结构 seed。
- `method_splits` 有 Push/Pull/Legs 三个空结构。
- `exercises` seed 只包含 5 个 Push 动作身份。
- `method_split_exercises`、`method_rules`、用户 progression、prescriptions 没有权威 seed 路径。
- `method_enrollments` 只绑定 `method_id`，没有 `method_release_id` 或 coaching policy release pin。
- `method_rules.rule_type` 当前不接受 Workbook 需要的 `principle`、`calibration`、`technique`。
- release-scoped uniqueness、激活审计、不可变约束、import run、diff、evidence link 都不存在。
- 所有用户 Method 表只有 select policy；当前也没有 server workflow 写入它们。

### 5.3 Spec Patch 要求但当前不存在的表

```text
method_source_documents
method_source_chunks
method_releases
canonical_import_runs
method_rule_sources
adaptation_policy_releases
adaptation_policies
initial_capability_profiles
user_training_state
workout_sessions
exercise_executions
set_executions
progression_events
recovery_checkins
recovery_decisions
training_deviations
training_discomfort_events
adaptation_decisions
user_coaching_signals
domain_events
```

并非这些表都应在 Phase 1 一次创建。Phase 1 只应建立 Source、Release、Canonical Import、Rules、Evidence 与 policy foundation；用户运行时事实表按后续 Phase 引入。

## 6. Method 能力逐项核验

| 能力 | 当前代码证据 | 状态 |
|---|---|---|
| Program | 有三 split 的 draft skeleton；无完整动作关系和可执行规则 | `PARTIAL / INACTIVE` |
| Method | 有 draft method row 和读取 API | `PARTIAL / INACTIVE` |
| Today Prescription | 表和读取 API/UI 存在；没有生成器和真实初始化 | `SKELETON ONLY` |
| Split | Push/Pull/Legs identity 存在 | `STRUCTURE ONLY` |
| Progression | 有 user state 表和 read API；无 rule seed、engine、event、write path | `NO_GO` |
| Calibration | 无 rule type、service、API 或 UI | `ABSENT` |
| Recovery | `recovery_decision_id` 仅预留，无表/引擎/UI | `ABSENT` |
| Guidance | Today 页面只展示处方摘要和素材；Canonical cues 未入 DB/UI | `ABSENT AS METHOD GUIDANCE` |
| Warm-up | schema 只有 rule key 和 set type；无 Canonical protocol | `ABSENT` |
| Method Explanation | 无 Context Builder、Evidence resolver、“为什么”入口 | `ABSENT` |
| Adaptive Coaching | 无 deviation/discomfort/pause/recalibration engine | `ABSENT` |
| Prescription vs Actual | 只有 prescription skeleton；Actual 仍是 legacy workout JSON | `NOT CONNECTED` |
| Release pinning | Enrollment 绑定 method identity，不绑定 immutable release | `ABSENT` |

## 7. 可直接复用的资产

1. Supabase Auth、SSR client 与当前所有权 RLS 设计模式。
2. 现有 `methods / exercises / exercise_media / exercise_external_mappings` 的基础身份与许可证字段。
3. `method_splits / method_split_exercises / method_rules` 表名和大部分业务关系，但必须改为 release-scoped。
4. `session_prescriptions / exercise_prescriptions / set_prescriptions` 的基本处方层级，后续补 release snapshot 与真正生成路径。
5. 极简 onboarding 已有的 goal/gender/height/reference weight contract。
6. Home、History、Weekly、Food、Body、Settings 的现有页面与数据，不应在 Method Phase 中删除。
7. OpenAI Responses API 严格 JSON 输出和明确 fallback 来源，可在 Phase 8 作为 explain/composer 复用。
8. `@bryllim/workout-guide@1.0.0`、Provider mapping、三帧动画与 attribution UI。代码为 MIT，视觉素材为 CC BY-SA 4.0；继续使用必须保留署名、许可证链接，并对改编素材遵守 ShareAlike。
9. 当前 SQL contract / performance contract / media contract 的测试形式，可扩展为 Release 和 importer contract。

## 8. 与最新 PRD / Spec 的冲突

| 冲突 | 当前实现 | 最新要求 | 处理建议 |
|---|---|---|---|
| Versioning | `methods.version/status` 与 `method_rules.version/status` 原地表达版本 | 独立 immutable `method_releases`，Enrollment pin release | Phase 1 新增 release，旧字段仅保兼容，不再作 runtime authority |
| Split versioning | `method_splits unique(method_id,key)` | Split 必须 release-scoped | 安全 backfill 后改为 `unique(method_release_id,key)` |
| Rule types | 不支持 principle/calibration/technique | Workbook 明确需要 | 扩展 check/typed config，不用多张文案表 |
| Onboarding | 保存 profile 后只返回 pending/unavailable | Phase 2 应创建 capability/enrollment/cycle/next split | 保持 Phase 1 不激活；Phase 2 再做原子初始化 |
| Workout 主入口 | Method unavailable 时仍以自由训练为主 | 正常主流程应由 Today Prescription 驱动，自由训练是 secondary | 保留 legacy 入口，但 active Method 后降为“额外训练” |
| Actual 粒度 | `workout_logs.exercises JSON`，动作只存汇总 sets/reps/weight | session/exercise/set executions，逐组 RIR/quality/failure | 新事实表，不破坏旧日志；History 做双读过渡 |
| Weekly adherence | `workout_count / weekly_workout_target` | 频率 recovery-dependent，不能直接当 adherence | 保留客观 count，移除 Method 语义上的百分比 |
| Review | 只读 legacy logs/profile/body | rules decide，AI explain；必须有 Prescription/Actual/Decision context | Phase 8 重构，现有 AI 仅作 composer |
| Settings | 仍允许编辑 weekly target 与 daily calories | Onboarding 不要求；正式算法仍 TBD | 标为 legacy，不在 Phase 1 删除 |
| Media gate | SQL contract 要求 active Method 的每个动作必须有 confirmed workout-guide mapping | 最新 Workbook 允许缺媒体时降级文字；Media 不提供 Method truth | Phase 1 改 gate：视觉素材质量独立，不阻塞有完整文字 Guidance 的 Method rule |
| Candidate media | Runtime 会展示 candidate mapping并标记待审核 | 可使用开源素材，但动作身份需审阅且保留署名 | 保持标记；不能把 candidate 当动作方法证据 |
| Progress Photo | 用户要求保留，但当前仓库没有实现 | 仍是核心能力 | 记录为缺失资产，后续单独恢复，不在 Phase 1 假称已存在 |
| Checklist/Badge/Milestone | 当前仅有日志 streak | 用户要求保留完整奖励层 | 后续 Phase 8 建立真实 event-driven 能力 |
| RAG dependency | 当前无 Source/RAG | RAG 用于证据检索，不能决定处方 | Phase 1 建 source/chunk；RAG 不可用时 Runtime 仍必须运行 |

## 9. 激活可能性

### 可以现在做

- 在当前 feature branch 开发 Phase 1 Source/Release/Importer/Evidence 基础设施。
- 将 Workbook 已生效行导入**新 draft release**。
- 对待补证据行保留 nullable/inactive，并生成 machine-readable validation report 与 diff。
- 用 Workbook `06/07/08/13` 建测试 fixture，但不把 fixture 当生产规则。

### 现在不能做

- 不能把当前 `methods.status` 直接改为 `active`。
- 不能创建声称“完整三分化可执行”的 Enrollment。
- 不能用 AI、通用健身知识或 workout-guide 素材补 Day3、绳索弯举或 Warm-up 处方。
- 不能把 Current Today 页面当作 Runtime 完成。
- 不能因 migrations 已推送或 build 通过而宣布 Method 激活。

### Active Release 的最小前置条件

1. 找回并固定原始 transcript 文件，校验 checksum，完成 source/chunk 可追溯。
2. 关闭 Q-001 与 Q-004，或明确把受影响 split/exercise 排除在 release 之外；当前产品目标要求完整三分化，因此推荐关闭后再激活。
3. Importer 对所有 Runtime Canonical sheet 通过结构、ID、状态、证据、引用、状态机和 blocker 校验。
4. 生成并审核 diff；创建新的 draft release；跑 rule/golden/DB/API tests。
5. 人工显式执行 activate；旧 release 不覆盖。
6. Phase 2 Enrollment 绑定 `method_release_id`，并证明历史可重放。

## 10. Phase 0 完成状态

### 10.1 2026-09-09 回归检查

| 检查 | 结果 | 证据边界 |
|---|---|---|
| TypeScript `--noEmit --incremental false` | PASS | 当前代码类型检查通过 |
| Source lint（排除 `.netlify`） | PASS | 项目源码无 lint error |
| 默认 `npm run lint` | FAIL | 扫描了 `.netlify` 中 Netlify 生成的第三方 edge-runtime/static 文件，出现 9,656 个问题；不是本轮文档或 Pawside 源码错误，但需要在后续把生成目录加入 ESLint ignores |
| Next.js production build | PASS | Next.js 16.3.4 编译、TypeScript、33 个静态页面生成完成 |
| Backend asset preflight | `READY_TO_APPLY / HOLD` | migrations/contracts/env 声明通过；全局 Supabase CLI、Docker、psql 未检测到 |
| workout-guide media validation | PASS | 5 个 Push mapping 可解析；3 confirmed、2 candidate |

这些检查证明当前 source/build 基线可继续开发，不证明 Method Runtime、远端数据库、用户 Enrollment 或端到端训练闭环已经可用。

- [x] 独立 branch 已创建。
- [x] Overview PRD、System Spec、两份 Patch 已完整读取。
- [x] Canonical Workbook 19 sheets 已只读解析。
- [x] 当前 routes、components、migrations、tables、API、AI、Media 已盘点。
- [x] 可复用资产和 legacy 冲突已列出。
- [x] Method active 状态明确为 `NO_GO`。
- [ ] 原始 transcript 未收到，无法完成 L0 Source 审计。
- [ ] Phase 1 尚未实施，等待确认。
