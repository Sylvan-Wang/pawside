# Pawside 2.0 Phase 0｜Gap Map

> 对照基线：当前 `D:\Pawside` vs 用户已确认的实际附件 PRD v0.1 + System Spec v0.1 + 用户本轮明确补充要求。  
> 版本边界：用户已确认不再等待另一份 v0.2；附件中显式 `[TBD]` 和缺失的最终 Method Tracking 值仍标为 `UNKNOWN`，不自行补规则。
> 数据边界：用户已确认旧 Supabase 项目和旧数据已删除；当前 `sbwevlhzqujrtucppacl` 是新建空项目。下表中的 legacy 策略表示为现有 GitHub 代码保留过渡兼容结构，不代表存在可跨项目迁移的历史数据。

## 1. 状态定义

| 状态 | 含义 |
|---|---|
| `KEEP` | 当前能力/结构可原样保留为 2.0 基础 |
| `REWORK` | 产品能力保留，但 UI、数据流或服务边界需重构 |
| `MIGRATE` | 现有数据必须保留并迁移/兼容读取 |
| `NEW` | 当前不存在，需要新增 |
| `DEPRECATED` | 保留兼容，但不再作为新业务真值 |
| `CONFLICT` | 当前行为与已确认原则直接冲突 |
| `UNKNOWN` | 当前证据不足，不能确认 |

## 2. 全模块对照

| 模块 | 主状态 | 当前实现证据 | 2.0 差距 / 决策 | Legacy 处理 |
|---|---|---|---|---|
| Auth | `KEEP` + `REWORK` | Supabase Auth、middleware、登录/注册/找回密码 | 保留 Auth；补 enrollment/onboarding guard、统一 server auth；核验 reset 回调与 API 鉴权 | 不迁移 auth identity |
| Profile | `REWORK` + `NEW` | 代码依赖 `user_profiles`，但新 Supabase 项目无该表、无可迁移旧数据 | 新建兼容 profile schema，并增加 `reference_weight_kg`；weekly target、manual calorie target 不再作为 Program/Nutrition truth | 兼容字段仅服务现有代码切流，不执行历史数据 copy |
| Onboarding | `CONFLICT` + `REWORK` | 页面要求用户输入 weekly workout target 和 calorie target，只 update profile | 新流程必须原子创建 profile + active method enrollment + cycle + progression states + first Push prescription | 已完成 onboarding 用户需幂等 bootstrap，不伪造既往训练阶段 |
| Home | `CONFLICT` + `REWORK` | 7 个客户端查询；显示“今天想做什么？”强制 popup；训练主 CTA 是“记录训练” | 删除 popup；改为 Method-aware Today；保留训练、饮食、周报、streak、review、体重所有旧能力；接统一 aggregator | 切换期可读取 legacy summary，但新 method state 走新 API |
| Method | `NEW` | 无表、domain、route、页面 | 新增 versioned official Method、splits、rules、exercises、说明 | 无 legacy 数据可迁移 |
| Program / Enrollment | `NEW` | 无 active program/cycle/next split | 新增 enrollment、cycle、next split、state machine；Cycle 与自然周分开 | 对老用户只创建“从 2.0 启用日开始”的 enrollment |
| Prescription | `NEW` | 无 session/exercise/set prescription | 新增“今天应该做什么”完整事实链 | 不从 legacy log 反推历史处方 |
| Workout | `CONFLICT` + `REWORK` | `/workout` 是自由完成后记录；新 Supabase 项目无 `workout_logs` 数据 | 新写入必须用 workout_session/exercise_execution/set_execution，并关联 prescription；需要 autosave、skip/稍后、恢复读取 | 可短期建立空的兼容表保证旧页面运行；无历史 backfill |
| Progression | `NEW` | 没有 progression state/event；只有 AI 对日志做一般总结 | 新增 method-specific、versioned、input/output snapshot、audit trail；AI 不得写 state | 旧记录不生成虚构 progression event |
| Nutrition | `CONFLICT` + `REWORK` | 仓库有结构化 reference migration；新 Supabase 项目尚无表，正式 UI 仍依赖 `food_logs.foods JSON` | 应用 migration 并接通 `user_food_logs/items/summary`；保存 food ID、basis、weight、4 macros；新增 parse；target 算法仍 TBD | 可短期建立空的 `food_logs` 兼容表；无历史 backfill |
| Body | `KEEP` + `REWORK` | 体重/体脂/肌肉量/围度/custom/notes 表单与趋势已存在 | 保留字段与输入；统一 `log_date`/`muscle_mass_kg` contract、currentWeight resolver、Review invalidation | 原始测量保留；字段 rename 用兼容 view/alias 或 additive column |
| Body Capture | `NEW` | 无照片、Storage、Capture | 用户本轮已明确 P1：正/侧/背、全身、距离、光线、清晰度、朝向、长期同角度；不输出精确体脂/医疗判断 | 无旧照片路径可证明；远端 bucket 状态 UNKNOWN |
| Recovery | `NEW` | 无 check-in/decision/rest state | P1 最小输入按用户本轮明确为睡眠、疲劳、疼痛/关节不适；非每日强制；规则产生 ready/caution/rest | 无 legacy recovery；旧缺失保持 unknown |
| Daily Review | `REWORK` + `CONFLICT` | 当前读取 legacy logs/profile，rule preprocess 后可调用 LLM，cache 到 `ai_generated_content` | 必须纳入 prescription/actual/nutrition/body/recovery/progression；规则先判断；完整 stale/version/input snapshot | 可复用 cache 表但换明确 content type/version；旧 review 保留历史展示，不作新决策真值 |
| Progress | `NEW` | 无 `/progress`；Home/Weekly 只有趋势卡 | 新增 Performance/Behavior/Outcome 三轴与 cycle/stage progress；禁止综合总分 | legacy logs 可做客观历史趋势，不计算未知 adherence |
| History | `KEEP` + `REWORK` | 日期卡片、详情、编辑/删除 legacy 日志 | 保留能力；详情增加 method/prescription/actual/recovery/reward；统一 API；修复修改后的依赖重算 | 双读 legacy + 2.0；明确 source/version；不丢旧编辑入口直到替代完成 |
| Weekly | `CONFLICT` + `REWORK` | 用 `workout_count / weekly_workout_target` 生成完成感和总结 | 保留全部旧客观指标；新增 method cycle/progression/nutrition consistency；不得把自然周次数等同 adherence | legacy count/trend 保留；旧 `weekly_summary` 只读兼容 |
| Checklist | `NEW` | 无统一 checklist；只有卡片状态 | 从业务事实动态派生；必要时只缓存非事实任务状态 | 不从点击行为伪造训练/饮食完成 |
| Streak | `REWORK` | Home 用近 60 天 workout/food date 在客户端计算 | 改为可审计 streak/domain events；正确休息不打断按方法执行 streak | 可用旧 dates 初始化 logging streak，但不初始化 planned-training streak |
| Milestone / Badge / Title | `NEW` | 无 | event-driven、触发条件可解释；文案列表仍 TBD，不自行定 | 无 legacy 数据 |
| Reward | `NEW` | 无 reward engine | 只消费真实事件，不反向制造训练真值 | 无 legacy 数据 |
| AI | `REWORK` + `DEPRECATED` | AI Review 有 provider fallback；`ai_plans` 只写 placeholder | 保留 composer/fallback 模式；增加 schema validation、model/prompt/rule/input evidence；AI 只解释 | `ai_plans` placeholder 不作为 Method；保留表只读/归档 |
| Database | `CONFLICT` + `NEW` | 只有 1 个 food migration；目标项目为空，其他运行表不可从仓库重建 | 从空库可复现地创建过渡兼容 schema + 2.0 schema、完整 RLS/FK/约束/events/invalidation；统一 ID 类型 | 不涉及旧项目数据搬迁；兼容表在对应页面切流前保留 |
| API | `REWORK` + `NEW` | 页面大量直接 Supabase；多个 API 与页面重复；无 shared validation | API 只做 auth/validate/service/serialize；新增 onboarding/method/training/nutrition/recovery/dashboard/review/progress/history contracts | legacy API 维持兼容，标版本/逐步切流 |
| Type / Validation | `NEW` + `REWORK` | strict TS + 局部 interfaces；无 Zod/shared DTO/database types | 建共享 schema/DTO，服务端 runtime validate，生成 DB types | legacy JSON 用 tolerant parser，不强行补字段 |
| RLS / Security | `UNKNOWN` + `REWORK` | 新 food tables policy 可见；7 张 legacy table policy 不在仓库；远端探测失败 | 导出线上 policy 后纳入 migration；user-owned own-row；reference authenticated read；修复 body API mass assignment | 未确认前不能判定隔离已通过 |
| Storage | `UNKNOWN` + `NEW` | 代码/migration 无 bucket 与 upload；远端未验证 | private body bucket、用户路径 policy、signed URL、删除/保留策略 | 发现远端旧媒体时先 inventory，再迁移 |
| Exercise Media | `NEW` | 未安装 `@bryllim/workout-guide`，无 mapping | Pawside 自有 `exercise_id`；新增 external mapping，保存 provider/slug/source version/license/attribution；只匹配当前三分化动作 | 外部 slug 永不成为 FK/business key |
| Navigation | `KEEP` + `REWORK` | 首页/历史/周报/设置四项 BottomNav | PRD 最终 IA 仍 TBD；Phase 1 不抢跑改一级导航 | 保留现导航直到产品锁定 |
| Export | `KEEP` + `REWORK` | Settings 客户端 CSV + `/api/export` 重复实现 | 保留用户数据导出；扩展新表并标 source/version；统一服务 | 必须继续导出 legacy 原始数据 |
| Analytics / Domain Events | `NEW` | 无 | Domain events 与 product analytics 分离；下游 stale/reward 使用事实事件 | legacy 行为不回填虚构事件 |

## 3. 最主要的架构冲突

### P0-1｜训练“要求”和“实际”没有分层

当前 `workout_logs.exercises JSON` 只有事后自由输入，无法证明用户原本应该做什么，也无法在 set 粒度审计 actual、progression 或 recovery。它不能成为 2.0 runtime 的新写入模型。

### P0-2｜结构化 Nutrition migration 与正式写入路径断开

当前食物搜索读取 `foods/food_aliases/food_nutrition`，但保存回 `food_logs JSON`，不保存 `food_id`、basis、fat/carb、source/version。用户还可直接覆盖自动热量/蛋白，导致“确定性计算”无法追溯。

### P0-3｜Profile 旧 targets 被当作正式规则真值

Onboarding、Home、Weekly、Review 都消费 `weekly_workout_target` / `daily_calorie_target`；这与 recovery-dependent frequency 和 TBD nutrition target algorithm 冲突。

### P0-4｜Dashboard/Weekly/Review 在多个客户端与 API 中重复聚合

没有统一 service/aggregator/version，修改事实后下游可能各自得到不同结果。Review invalidation 当前漏掉 body、API 写入、旧日期和 sessionStorage。

### P0-5｜数据库不可从当前仓库完整重建

应用核心依赖的 legacy schema/RLS 没有 migration。远端又未能只读连接，因此当前不能对 FK、RLS、trigger、bucket 做“已验证”声明。

### P0-6｜API 边界和运行时校验不足

大部分页面直接访问 Supabase；API/页面重复逻辑；没有 Zod/shared DTO；`/api/body-metrics` 允许 body 覆盖 `user_id`。安全性依赖未核验 RLS。

## 4. 可直接复用的旧代码

“直接复用”指可作为基础保留，不等于无需修改调用方。

| 可复用项 | 文件 | 复用方式 |
|---|---|---|
| Supabase SSR/browser client | `lib/supabase/server.ts`, `lib/supabase/client.ts` | 保留 client factory，domain repository/server API 统一使用 |
| Supabase Auth 流程 | `app/auth/**`, `middleware.ts`, `app/page.tsx` | 保留登录/注册/找回密码；补 guard 和错误/回调测试 |
| 中文移动端壳/PWA | `app/layout.tsx`, `app/globals.css`, `app/manifest.ts` | 保留 mobile-first 基线 |
| 通用 UI | `components/BottomNav.tsx`, `PageHeader.tsx`, `Toast.tsx` | 继续使用；导航 IA 暂不改 |
| Home 旧能力清单 | `app/home/page.tsx` | 训练、饮食、weekly、streak、review、体重趋势全部迁入新 aggregator UI |
| Body form 字段与 kg/lb 转换 | `app/body-metrics/page.tsx` | 保留输入能力；改 API、字段 contract 和 invalidation |
| History/Weekly 图表与交互 | `app/history/**`, `app/weekly/page.tsx` | 作为双读展示层基础；数据改由新 API 提供 |
| Food reference schema/seeds | `supabase/migrations/20260413000000_v3_food_schema.sql`, `supabase/seeds/**` | 先验证数据来源/ID/重复 seed，再接正式 normalized write |
| Food search UX 与计算 helper | `app/food/FoodPageClient.tsx` | 拆组件/服务；扩展 4 macros；禁止无 basis 的真值写入 |
| AI provider client/fallback | `lib/ai-client.ts` | 降为 composer；补严格 schema、版本/evidence；不用于 progression decision |
| Rule-first preprocessor 形态 | `lib/ai-rules.ts` | 保留“先规则后 AI”的分层思想，替换 legacy 输入与未锁算法 |
| CSV export 能力 | `app/api/export/route.ts` | 统一服务并支持 legacy + 2.0 数据来源标记 |

## 5. 兼容结构与迁移边界

当前没有旧项目数据源，以下策略只约束“若当前应用继续写入兼容表后”如何切流；Phase 1 不做任何跨项目数据搬迁。

| 数据 | 迁移策略 | 禁止事项 |
|---|---|---|
| `user_profiles.weight_kg` | 新表同时提供 `weight_kg` 与 `reference_weight_kg`；新 onboarding 写入明确 reference；过渡期 resolver 双读 | 不伪造历史 copy；不把后续 body weight 覆盖成 onboarding reference |
| `weekly_workout_target` | 保留列供 legacy UI/导出；2.0 Program/Weekly 停止作为 adherence truth | 不用它生成 2.0 完成百分比 |
| `daily_calorie_target` | 保留为明确标记的 fallback，直到 target algorithm 锁定 | 不把 `weight × 31` 固化为正式算法 |
| `workout_logs` | 空兼容表仅承接尚未切流的现有页面；新 runtime 完成后停止新写 | 不从兼容 JSON 伪造 prescription、RIR/RPE、quality、progression stage |
| `food_logs` | 空兼容表仅承接尚未切流的现有页面；Nutrition Phase 切到 normalized write | 不从兼容 JSON 猜 food ID、weight、fat/carb 或 calculation basis |
| `body_metrics` | 原值保留；用兼容 mapping 处理 `date/log_date`、`muscle_mass/muscle_mass_kg` | 不重写用户测量值 |
| `weekly_summary` | 只读兼容/导出；新 Weekly 从 facts 聚合并带 version | 不把旧 summary 当新 Method adherence |
| `ai_generated_content` | 旧 content type 保留；新 review 使用新 version/type 与 input evidence | 不让旧 AI 文本成为业务真值 |
| `ai_plans` | placeholder 数据保留/归档；停止作为官方 Method 来源 | 不把 placeholder draft 转成正式 Method |

## 6. `UNKNOWN` / 实施前必须补证据

1. **最终 Method Tracking 数据**：PRD/Spec 都说明全部动作、组次、stage、progression transition 必须来自最终 Tracking 表；当前附件未包含完整锁定值。
2. **目标 Supabase DDL 应用状态**：`.env.local` 已切到新建 `sbwevlhzqujrtucppacl`；已知 14 张当前应用表全部返回 schema-cache 404。需要先应用受审 migration，再核验 schema、policy、trigger、grant。
3. **线上 Storage**：匿名 bucket list 为 0；用户确认无旧项目媒体迁移。Body Capture Phase 再创建并核验 private bucket、policy 与生命周期。
4. **Nutrition target algorithm**：System Spec 明确 TBD。
5. **一级 Navigation / Method page**：PRD 明确 TBD，Phase 1 不改 BottomNav。
6. **Workout 细节**：RIR/RPE 主输入、每组是否必填、换序、timer、自由训练尚未最终锁定；用户本轮仅明确要“还能再做几次”、skip/稍后做。
7. **Reward 的具体 badge/title 文案**：方向确认、清单未确认。

## 7. Phase 1 进入开发的 Gate

Phase 1 可先做无争议基础设施。用户已确认现有两份附件就是 Source of Truth；但“官方 Method seed + 第一份 Push prescription”进入可验收状态前至少还需要：

- 提供/定位最终 Method Tracking 表，确认 Push 动作的 rule key、完整 set prescription 与初始 stage；
- 在向目标项目应用 migration 前导出/确认 public schema + policies；当前 publishable-role 探测未发现任何应用已知表；
- 确认老用户首次启用 2.0 的 enrollment 起点策略（建议只从启用日开始，历史不反推阶段）。

这些 Gate 不阻止先新增 additive schema、domain contract、幂等 onboarding workflow 与 legacy compatibility 测试，但阻止凭模型补齐方法规则。
