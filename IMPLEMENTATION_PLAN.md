# Pawside 2.0｜Implementation Plan

> 计划日期：2026-09-04  
> 依据：当前仓库审计 + 用户确认作为 Source of Truth 的实际 PRD v0.1 + System Spec v0.1 + 用户本轮明确优先级。  
> 状态：Phase 0 文档审计完成；尚未开始 Phase 1 业务实现。  
> 规则 Gate：最终 Method Tracking 数据提供前，不写死文档 `[TBD]` 或猜测 progression rules。目标 Supabase project ref 为 `sbwevlhzqujrtucppacl`；用户确认它是新建空项目，旧项目/旧数据已删除，因此无跨项目数据迁移。当前应用已知 public 表均返回 schema-cache 404，需从受审 migration 建库。

## 0. 实施总策略

### 0.1 数据层次

所有开发必须保持单向数据流：

```text
原始事实
→ 方法要求
→ 规则派生
→ 展示 / AI 解释
```

- 原始事实：用户 profile 输入、set actual、food weight、body metric、recovery input。
- 方法要求：versioned Method/Rule、session/exercise/set prescription。
- 规则派生：nutrition totals、completion/adherence、progression/recovery decision、checklist/reward events。
- 展示/AI：Dashboard snapshot、Daily/Weekly Review、用户可读解释。
- 展示或 AI 输出不得反向覆盖前三层真值。

### 0.2 Migration 原则

- 全部先 additive migration；不 drop legacy 表/列。
- 每个 migration 配套：preflight query、up migration、rollback SQL、post-check、RLS review。
- 新写入只认 2.0 表；legacy 表保持 read compatibility，不双写两个真值源。
- backfill 必须保存 `source = legacy`/mapping evidence；不存在的数据保持 null。
- 每个业务写入通过 domain service 触发依赖失效，避免页面自行拼接副作用。

### 0.3 建议代码边界

保持当前无 `src/` 的项目结构，新增 `lib/domain/*`，避免一次性搬迁整个仓库：

```text
lib/domain/
├── profile/
├── method/
├── program/
├── workout/
├── progression/
├── recovery/
├── nutrition/
├── body/
├── review/
├── dashboard/
├── reward/
└── events/
```

Route Handler 只负责：auth → Zod validation → service → response。React 页面不实现 progression/nutrition arithmetic。

### 0.4 每 Phase 统一验收

每个 Phase 完成后必须执行并记录到 `IMPLEMENTATION_STATUS.md`：

1. `typecheck`
2. ESLint（先修复 Next 16 lint runner）
3. migration apply + rollback + re-apply validation
4. RLS own-user / cross-user tests
5. API smoke tests（unauth、valid、invalid、idempotency）
6. 375px/390px/430px mobile layout smoke
7. 核心用户流 smoke
8. stale/invalidation 与 legacy read regression

## Phase 0｜Current State Audit（本轮）

### 目标

建立当前真实实现、差距与迁移边界，不改业务逻辑或数据库。

### 输出文件

- `CURRENT_STATE.md`
- `GAP_MAP.md`
- `IMPLEMENTATION_PLAN.md`

### 结果

- Route、Component、DB、API、Type、Auth/RLS、Storage 已静态审计。
- TypeScript 基线通过；lint runner 失败；无测试。
- 已确认两份实际附件为 Source of Truth。
- 目标项目 Auth API 可达；当前应用依赖的 14 张表全部未在 publishable schema cache 中找到；匿名可见 bucket 为 0。
- 仍有 Method Tracking、完整 schema/RLS/grant 与 private Storage 三类证据缺口。

### 依赖

无。

---

## Phase 1｜Method + Onboarding Foundation [P0]

### 目标

实现幂等链路：

```text
新用户注册
→ Minimal Onboarding
→ 官方三分化 Enrollment
→ Cycle 1
→ 初始化动作 progression state
→ 生成首个 Push prescription
→ Home 明确显示 Day 1 / Push
```

### 计划涉及文件

现有修改：

- `app/onboarding/page.tsx`
- `app/home/page.tsx`（只接 bootstrap/Today Training，不在此 Phase 完整重构 Dashboard）
- `app/page.tsx`
- `middleware.ts`
- `package.json`（Zod、lint/test 工具；不引入未审计动作全集）

新增：

- `lib/supabase/database.types.ts`
- `lib/domain/profile/schema.ts`
- `lib/domain/profile/service.ts`
- `lib/domain/method/types.ts`
- `lib/domain/method/repository.ts`
- `lib/domain/method/service.ts`
- `lib/domain/program/service.ts`
- `lib/domain/program/prescription-generator.ts`
- `lib/domain/events/service.ts`
- `app/api/onboarding/route.ts`
- `app/api/method/current/route.ts`
- `app/api/method/current/progress/route.ts`
- `app/api/training/today/route.ts`
- `components/method/TodayMethodHeader.tsx`
- `components/workout/TodayTrainingCard.tsx`
- `tests/domain/method/**`
- `tests/api/onboarding/**`

文件名可在实现时按现有 test runner 约定微调，但业务边界不变。

### 新表 / migration

建议拆成两个可回滚 migration，降低故障半径：

1. `supabase/migrations/<ts>_profile_compatibility.sql`
   - add `reference_weight_kg`
   - copy from legacy `weight_kg` when null
   - 保留 weekly/calorie legacy columns
   - 补/核验 profile RLS、updated_at 机制
2. `supabase/migrations/<ts>_method_foundation.sql`
   - `methods`
   - `method_splits`
   - `exercises`
   - `exercise_media`
   - `exercise_external_mappings`
   - `method_split_exercises`
   - `method_rules`
   - `method_enrollments`
   - `method_cycles`
   - `user_exercise_progression`
   - `session_prescriptions`
   - `exercise_prescriptions`
   - `set_prescriptions`
   - 最小 `domain_events`

配套：

- `supabase/rollbacks/<ts>_method_foundation.down.sql`
- `supabase/seeds/seed_official_three_split_v1.sql`
- `supabase/tests/method_foundation_rls.sql`

### Seed / 动作素材

- Method key 固定为官方三分化的 versioned key；所有 rule key/version 来自最终 Method Tracking 数据。
- Pawside 自己生成并持有 `exercise_id`。
- `exercise_external_mappings` 保存：`exercise_id`、provider、external_slug、source_version、license、attribution、metadata、verified_at。
- `@bryllim/workout-guide` 仅做视觉素材 provider；Phase 1 只为三分化实际动作建立人工/半自动 mapping，不整库导入。
- 在 license/version 未核验前不把第三方素材进入生产 seed。

### API

- `POST /api/onboarding`：事务/幂等 workflow，不能只 update profile。
- `GET /api/method/current`
- `GET /api/method/current/progress`
- `GET /api/training/today`

Onboarding POST 必须具备 idempotency：重复提交不创建第二个 active enrollment/cycle/prescription。

### UI

- Onboarding 只保留 goal、gender、height、reference weight。
- 删除 weekly workout target 与 manual calorie target 输入。
- Home 删除“今天想做什么？”popup。
- 初始 Home 显示“三分化 · 第 1 轮 · Push / Day 1”与“开始今天”。
- BottomNav 暂不改，因最终 IA 仍 TBD。

### 数据迁移

- 不存在跨项目 legacy 数据迁移或老用户历史 backfill。
- 从空库创建当前页面所需的最小兼容表和 2.0 Method foundation；兼容表仅用于逐 Phase 切流。
- 新用户 onboarding 直接写 `reference_weight_kg`，不从不存在的历史记录推断 progression。

### 风险

- 完整 Method Tracking 未提供时，不能完成正式 rule seed/set prescription。
- 新项目当前为空；风险从“覆盖远端旧结构”变为“migration 必须能从空库完整、顺序一致地重建并通过 RLS 验证”。
- `methods`/food reference ID 类型需统一；当前 food migration 用 serial，而 v0.1 示例写 UUID。
- 并发 onboarding 需 partial unique index 保证每用户最多一个 active enrollment。

### 验收方式

- 新账号 → onboarding → 只填 4 类确认字段 → Home。
- DB 只出现一个 active enrollment、一个 cycle 1、一个 ready Push prescription。
- 刷新/重复提交不重复创建。
- 另一个用户不能读取该 enrollment/prescription。
- Home 保留旧饮食、体重、周报、Review 能力占位/数据，不变成 training-only。

### 依赖

- 依赖 Phase 0。
- 正式 rule seed 验收依赖最终 Method Tracking；migration apply 前需对目标项目 `sbwevlhzqujrtucppacl` 做 schema/RLS preflight。

---

## Phase 2｜Workout Runtime [P0]

### 目标

把“今天应该做什么”与“实际做了什么”分离，并支持低摩擦、可恢复的逐组记录。

### 涉及文件

- 新增 `app/training/[prescriptionId]/page.tsx`
- 新增 `components/workout/SessionHeader.tsx`
- 新增 `ExerciseQueue.tsx`, `ExerciseCard.tsx`, `SetLogger.tsx`, `SaveState.tsx`
- 新增 `lib/domain/workout/schema.ts`, `service.ts`, `repository.ts`, `autosave.ts`
- 现有 `/workout` 保留为 legacy/free-record compatibility，不作为主 CTA

### 新表 / migration

- `workout_sessions`
- `exercise_executions`
- `set_executions`
- idempotency key / version columns
- 必要的 unique/FK/check constraint 与 RLS

### API

- `POST /api/training/:prescriptionId/start`
- `POST/PUT /api/training/sessions/:sessionId/sets`
- `POST /api/training/exercises/:executionId/complete`
- `POST /api/training/exercises/:executionId/skip`
- `POST /api/training/sessions/:sessionId/complete`
- `GET /api/training/sessions/:sessionId`

### UI

- Exercise queue、today prescription、previous performance、逐组 weight/reps/“还能再做几次”。
- skip/稍后做、动作完成、session completion。
- 每组提交即 autosave；optimistic UI + 本地 pending queue + retry 状态。
- 不强制每组填写未锁定的多余字段；quality/failure 的触发规则等待文档 TBD/UI lock。

### 数据迁移

- 新训练只写 normalized actual。
- History 双读；legacy `workout_logs` 不回填未知 prescription/RIR/quality。

### 风险

- 离线并发、重复 set、刷新恢复、跨设备冲突。
- skip/换序/progression 处理仍需最终规则确认。

### 验收方式

- 完成完整 Push，刷新后所有 set actual 可恢复。
- 断网记录进入 pending，恢复后幂等提交，不重复 set。
- Prescription 数据与 Actual 可分别查询；修改 actual 会发出 stale/event。

### 依赖

依赖 Phase 1 prescription foundation。

---

## Phase 3｜Progression [P0]

### 目标

按每个动作自己的 versioned Method rule 评估 progression，并生成下一次处方。

### 涉及文件

- `lib/domain/progression/types.ts`
- `lib/domain/progression/engine.ts`
- `lib/domain/progression/rule-loader.ts`
- `lib/domain/progression/service.ts`
- `lib/domain/program/prescription-generator.ts`
- progression rule fixtures/tests

### 新表 / migration

- `progression_events`
- progression evaluation status/pending retry fields
- 如需要，`prescription_generation_runs` 保存 generation evidence

### API

- session complete workflow 内部调用，不开放 AI 写 state。
- `GET /api/progression/exercises/:exerciseId/history`
- 管理/重算 API 只限 server/admin，并保存 reason/evidence。

### UI

- 训练完成页显示 progress/maintain/repeat/regress/more-data 的中文解释。
- Home/Progress 显示最近真实进步，不显示全局自动加重。

### 数据迁移

- 不从 legacy workout 推断 stage transition。
- 新 enrollment 从明确初始 stage 开始。

### 风险

- Method rule tracking 不完整是硬阻塞。
- actual 修改后的重算必须处理旧 event supersede，而非静默覆盖审计记录。

### 验收方式

- 每个 Push 动作使用不同 rule key/version。
- event 保存 input/output snapshot、from/to stage、session ID。
- 修改 set actual → 重算 → state/next prescription/review/weekly/progress 全部 stale/update。
- AI 代码路径无法直接 update progression state。

### 依赖

依赖 Phase 2 actual；正式规则依赖最终 Method Tracking。

---

## Phase 4｜Home / Dashboard [P0]

### 目标

重构 Home 为统一训练运行状态面板，同时完整保留旧 Dashboard 能力。

### 涉及文件

- `app/home/page.tsx`
- `app/api/dashboard/today/route.ts`
- `lib/domain/dashboard/aggregator.ts`
- `lib/domain/dashboard/schema.ts`
- `components/dashboard/**`

### 新表 / migration

- 默认不新增事实表。
- 若性能需要，只加带 `source_version/stale_at` 的 snapshot/cache，不成为真值。

### API

- `GET /api/dashboard/today?date=` 一次返回 method、recovery、workout、nutrition、checklist、body、weekly、cycle、recent progress、review preview。

### UI

- 今日训练、今日饮食、Checklist、今日总结、当前体重/趋势、本周状态、连续记录、三分化进度、最近进步。
- 状态支持 first/ready/in-progress/completed/rest。
- 删除 popup 与“新建训练记录”主入口。

### 数据迁移

- aggregator 双读 legacy + 2.0；响应明确 source/availability，不伪造缺失字段。

### 风险

- training-only 回归；多源日期/时区不一致；cache stale。

### 验收方式

- 旧 Home 9 类能力逐项 parity checklist 全通过。
- 每次 set/meal/body/review/progression 更新后 Home 可观察到正确更新。
- Rest 日仍可记录饮食/身体/复盘，next split 不跳序。

### 依赖

依赖 Phase 1–3；Nutrition 卡可先双读，Phase 5 后切 normalized source。

---

## Phase 5｜Nutrition [P0/P1]

### 目标

把已存在的 food reference 数据真正接入 normalized Meal/Item 写入和 deterministic 4-macro 计算。

### 涉及文件

- `app/food/FoodPageClient.tsx`
- `app/food/[id]/edit/page.tsx`
- `lib/domain/nutrition/schema.ts`
- `calculator.ts`, `matcher.ts`, `service.ts`, `repository.ts`, `target-service.ts`
- `app/api/nutrition/parse/route.ts`
- `app/api/nutrition/logs/route.ts`
- `app/api/nutrition/logs/[id]/items/route.ts`
- `app/api/nutrition/day/route.ts`

### 新表 / migration

- 对现有 7 张 food 表做 compatibility migration，而不是重复建表。
- 补齐 source/version/status/input_mode 枚举差异。
- `nutrition_targets`。
- daily summary 重算 function/transaction 与 stale event。

### API

- search/detail 沿用但加 auth/contract。
- parse 只返回候选，不写真值。
- confirmed item 写入时 server 端按 basis × confirmed weight 计算，客户端数值不可信任。

### UI

- 标准食物 + 重量；自然语言候选 + 一次确认；portion template。
- 展示 kcal/protein/fat/carb 与 calculation basis 来源。
- Food Photo 不做（P2）。

### 数据迁移

- legacy `food_logs` 继续读。
- 只 backfill 能确定 food match、weight、basis 的 item；无法确定则保持 legacy raw。

### 风险

- 当前 food ID serial vs Spec UUID；seed 重复/sequence；数据许可/版本；target algorithm TBD。

### 验收方式

- 修改食物重量后 4 macros 可按保存 basis 精确重算。
- Food Item → Daily Summary → Dashboard → Review/Weekly stale 链通过。
- AI parse 失败/模糊时不生成假营养数值。

### 依赖

依赖 Phase 4 aggregator contract；target 精确算法依赖产品锁定，未锁定前允许 target unavailable/legacy fallback 标签。

---

## Phase 6｜Daily Review [P1]

### 目标

将现有 AI 日总结升级为 Method-aware、rule-first、可版本化的 Review。

### 涉及文件

- 重构 `lib/ai-rules.ts`, `lib/ai-client.ts`
- 重构 `app/api/ai/daily-review/route.ts`
- 新增 `lib/domain/review/preprocessor.ts`, `evaluator.ts`, `composer.ts`, `invalidation.ts`
- 新增完整 Review 页面/组件（最终 route 命名随 IA 锁定）

### 新表 / migration

- 可复用 `ai_generated_content`，补 input snapshot、rule version、model、status、stale_at、generated_at；或新增 `daily_reviews`。
- 不删除旧 content types。

### API

- `GET /api/review/daily?date=` 只读 cache。
- `POST /api/review/daily` 生成/重生成。
- feedback API 保留。

### UI

- Summary、训练/饮食/恢复关键结果、Progress、1–3 个行动、Data Quality。
- Home 只显示 preview，History 显示完整依据。

### 数据迁移

- 旧 review 保留为 legacy presentation；不进入 progression/recovery 决策。

### 风险

- LLM schema drift、成本、stale race、raw data 泄漏。

### 验收方式

- input 含 prescription + actual + nutrition + body + recovery + progression。
- 规则输出固定后，关闭 AI 仍能得到 rule fallback。
- 任一上游修改正确 stale；重新生成带新 input/rule version。

### 依赖

依赖 Phase 2、3、5；Recovery 部分可先 unknown，Phase 7 后补全。

---

## Phase 7｜Recovery [P1]

### 目标

用最小输入和已有训练信号判断今天继续、谨慎、建议休息或数据不足。

### 涉及文件

- `lib/domain/recovery/schema.ts`, `engine.ts`, `service.ts`
- `app/api/recovery/checkin/route.ts`
- `app/api/recovery/today/route.ts`
- `components/recovery/RecoveryPrompt.tsx`, `RecoveryStatus.tsx`

### 新表 / migration

- `recovery_checkins`
- `recovery_decisions`
- RLS、unique user/date/version、input snapshot

### API

- POST check-in；GET today decision。
- decision 只由 rule engine 写入，AI 只解释。

### UI

- 用户本轮已明确 V1 三问：昨晚睡得怎么样、今天整体有多累、是否明显疼痛/关节不适。
- 仅异常/主动触发时询问，不每日强制。

### 数据迁移

- 无历史字段则保持 insufficient/unknown；不由 Workout/AI 猜睡眠或疼痛。

### 风险

- 疼痛输入涉及安全表达；不能医学诊断。
- rest decision 不能改变 split 顺序。

### 验收方式

- 正常无异常不强弹问卷。
- rest recommended 后 prescription 保留并顺延，next split 不跳。
- 正确休息不破坏 planned-method streak。

### 依赖

依赖 Phase 2/3 的表现信号与 Phase 4 Home 状态。

---

## Phase 8｜Progress / Weekly / Reward [P1]

### 目标

完成三轴 Progress、Method-aware Weekly 和真实事件驱动的持续反馈。

### 涉及文件

- 新增 `app/progress/page.tsx`
- 重构 `app/weekly/page.tsx`, `app/api/weekly/route.ts`
- `lib/domain/reward/engine.ts`, `streak.ts`, `service.ts`
- `lib/domain/dashboard/checklist.ts`
- `app/api/progress/overview/route.ts`
- `components/progress/**`, `components/reward/**`

### 新表 / migration

- `achievement_definitions`
- `user_achievements`
- `user_streaks`
- 可选 checklist cache；事实项优先动态派生

### API

- `GET /api/progress/overview`
- `GET /api/review/weekly?week_start=`
- reward/streak read endpoints

### UI

- Performance / Behavior / Outcome 分开展示。
- Weekly 保留训练次数、时长、饮食次数、平均/总热量、体重变化和三类趋势。
- Checklist、Today/Cycle/Progression progress bar、Streak、Milestone、Badge/Title。

### 数据迁移

- legacy 事实可用于客观 trends/logging streak。
- 不用 legacy 自然周次数生成 Method adherence 或 stage achievement。

### 风险

- badge/title 具体清单仍 TBD。
- 时区、自然周边界、rest-safe streak 定义。

### 验收方式

- Weekly 旧指标 parity 全通过。
- 自然周与 Method cycle 同屏但不混淆。
- 正确休息不打断按方法执行；奖励均能追溯 source event。

### 依赖

依赖 Phase 2–7 的事实/事件。

---

## Phase 9｜Body Capture P1

### 目标

按用户本轮明确优先级，把 Body Capture 作为 P1：建立长期可比的正面、侧面、背面照片采集，不做精确体脂或医疗判断。

### 涉及文件

- `app/body-metrics/page.tsx`（入口保留）
- 新增 body capture 页面/组件
- `lib/domain/body/capture-schema.ts`, `capture-service.ts`, `quality.ts`
- `app/api/body/photos/route.ts`
- `app/api/body/capture-sessions/route.ts`

### 新表 / migration

- `body_progress_photos`
- `capture_sessions`
- `body_capture_templates`
- private storage bucket + storage policies

### API

- 创建 capture session、签名上传、确认 photo、按日期读取、删除及 media lifecycle。

### UI

- 正/侧/背引导；全身入镜、距离、光线、清晰度、朝向、相机高度；长期同角度对比。

### 数据迁移

- 先 inventory 远端未知 bucket；存在旧照片时保存原路径/source，不重编码或 AI 补标签。

### 风险

- 高敏媒体隐私、signed URL 生命周期、删除一致性、浏览器 camera permissions。
- v0.1 Development Phase 把 Vision 放 P2，但用户本轮明确覆盖为 Body Capture P1；Food Photo 仍 P2。

### 验收方式

- 用户只能读写自己的 private path。
- 三角度采集状态可恢复；不合格照片给质量提示但不产出虚假身体结论。
- 删除 DB record 时 media lifecycle 有明确、可测试行为。

### 依赖

依赖 Phase 4 Dashboard/History 接入和线上 Storage inventory；不依赖 Food Photo/Exercise Vision。

---

## 10. 跨 Phase 数据修改与重算契约

### 10.1 Training actual 修改

```text
Set Execution changed
→ 写 immutable change/domain event
→ supersede + rerun progression evaluation
→ update user progression state
→ invalidate/regenerate future affected prescription
→ Daily Review stale
→ Weekly stale
→ Progress stale
→ Dashboard stale
```

必须用事务/outbox 或可重试 workflow；Rule Engine 失败不阻止保存 actual，但 progression 标 pending。

### 10.2 Nutrition 修改

```text
Food Item changed
→ server deterministic recalculate
→ daily nutrition summary
→ Dashboard stale
→ Review stale
→ Weekly stale
→ Progress stale
```

### 10.3 Body / Recovery 修改

```text
Body/Recovery fact changed
→ current weight/recovery resolver
→ Dashboard stale
→ Review stale
→ Weekly/Progress stale
→ future recommendation rerun only when rule dependency declares it
```

## 11. Phase 1 准备修改的文件（明确清单）

收到剩余 Gate 输入并获准开始 Phase 1 后，第一批实际变更限定为：

1. `supabase/migrations/*profile_compatibility.sql`
2. `supabase/migrations/*method_foundation.sql`
3. `supabase/rollbacks/*method_foundation.down.sql`
4. `supabase/seeds/seed_official_three_split_v1.sql`
5. `lib/supabase/database.types.ts`
6. `lib/domain/profile/**`
7. `lib/domain/method/**`
8. `lib/domain/program/**`
9. `lib/domain/events/**`
10. `app/api/onboarding/route.ts`
11. `app/api/method/current/route.ts`
12. `app/api/method/current/progress/route.ts`
13. `app/api/training/today/route.ts`
14. `app/onboarding/page.tsx`
15. `app/home/page.tsx`
16. `app/page.tsx`
17. `middleware.ts`
18. `components/method/**`
19. `components/workout/TodayTrainingCard.tsx`
20. `tests/domain/method/**` 与 `tests/api/onboarding/**`
21. `package.json` / lockfile（仅 validation/test/lint 所需依赖）

不在 Phase 1 修改：legacy Workout/Food/Body 数据、旧 History/Weekly 业务逻辑、BottomNav IA、Nutrition target algorithm、完整 Runtime、Progression decision、Body Capture。

## 12. 开发状态记录模板

每 Phase 结束更新 `IMPLEMENTATION_STATUS.md`：

```text
Phase
状态
已完成
待完成
数据库变化
API变化
UI变化
已知问题
下一步
```

状态只能基于实际证据使用：`NOT_STARTED`、`IN_PROGRESS`、`PARTIAL/HOLD`、`COMPLETE`；不得把 migration 文件存在、测试通过或 Mock/fallback 成功单独表述为产品端到端验收完成。
