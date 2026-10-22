# 居家轻力量 × 现有实现｜冲突检查（v0.6 定稿方案）

检查日期：2026-10-22。对象：`PATCH_v0.6_simplified.md`（取代 `PATCH_v0.5_review.md` 中冲突部分）。
基线：`master` e6488cd，已有 `ksw_tcy_three_split_2026`、`four_split_2026`。

范围与方式：只读 migrations、`lib/contracts/onboarding.ts`、`lib/method-availability.ts`、`app/api/method/*`、`lib/method-catalog.ts`、`lib/site/features.ts`、`app/training`、`app/workout`。**没有跑应用**；标「待核」的需实现时确认。本次只落文档，不改数据库、前端、官网。

关系：**新增并存**，现有两套方法不变。

## 已定决策（v0.5 的冲突如何收口）

| 原冲突 | 决定 | 剩余工作 |
|---|---|---|
| A1 多场地/多器械字段与现有单值 `equipment_access` 冲突 | 不新增字段，保留现有三选一 | 无字段迁移；旧用户无需迁移 |
| A2 可用性全局只认 `full_gym` | **改**：每个方法声明器械等级，按方法判断；全部方法展示，不匹配灰显+确认 | 见下表「要改的代码」 |
| A3 自由组合的「已有能力」前提不成立 | 删除自由组合；固定五日 + 徒手/小器械两版；调整仅「切换版本、跳过动作」 | 无新增编辑器 |
| A4 模板改动后的计数 | 随 A3 消失；复用现有 完成 / 提前结束 / 未练 三种结局；短版 = 开关（每动作 1 组，做完即完成） | 短版如何生成 1 组处方：待核 |
| 左右侧记录、环带类型与阻力 | 删除 | 无 |

## 要改的代码（A2 及相关）

1. 方法声明器械等级（徒手 / 小器械 / 健身房）。落点：`method_releases` 或 `methods` 上的新列，或 `source_metadata`；建议新增列并在迁移里为现有两套方法回填 `full_gym`。**不留双轨**：判断逻辑只读新字段。
2. `lib/method-availability.ts`：`evaluateMethodAvailability` 不再全局拦截；改为对每个方法返回「可用 / 需确认（缺少 xxx）」。提示语去掉写死的「三分化」。
3. `app/api/method/library/route.ts`：返回每个方法的可用状态与所需器械；`app/api/method/current/route.ts` 同步。
4. 方法选择界面：全部展示，不匹配灰显、排在下面，点击弹确认。具体组件待核。
5. `app/home/page.tsx`：`EQUIPMENT_REVIEW_REQUIRED` 目前会让整张方法卡不可用，需改为只在「没有任何方法可用」时才出现；`app/api/onboarding/route.ts` 里对应分支同步。
6. `lib/method-catalog.ts` 的 `MethodSplitKey = 'push' | 'pull' | 'legs'` 与新 split key 的关系：待核（运行时已用泛化后的 split key，但此处的类型仍写死三分化）。
7. 迁移现状：split key 已泛化，`day_type` 有 `cardio`，`record_shape` 有 `bodyweight_reps / duration`。无需为这些再迁移。
8. 现有回归测试（`tests/method-rules/availability.test.ts`、`tests/method-rules/onboarding.test.ts`）会随判断逻辑一起改，需保证三分化/四分化行为不变。

## 仍需新增

- 动作的可选教程链接字段（每个动作一个 B 站 URL，含来源账号核验状态）。`exercise_external_mappings` 是 GIF 素材映射，不复用。
- 「按版本取内容」：一个方法两个版本（徒手 / 小器械）。实现方式（两个 release、同一 release 的两组 split，或版本字段）待定，实现前需先看 `method_releases` 与 `switch_method_release_v1` 的约束，见「待核」。

## 待核（本次没有证据）

1. 短版开关如何落到处方生成器（每动作 1 组）。
2. 现有完成判断（`complete_method_session_v2`）对「跳过动作」的阈值。
3. 训练外跳返回后的恢复：`training-draft-store`、`training-offline-queue`、会话时长接口的覆盖程度。
4. BW 动作（跪姿俯卧撑、俯卧 W 抬臂、反向雪天使、死虫式、鸟狗式、侧卧抬腿）在 `@bryllim/workout-guide`（CC BY-SA 4.0，需署名）里是否有素材；缺则文字降级，不阻塞。
5. 通用埋点层是否存在；v0.6 不再要求专门事件，仅保留「教程点开 / 返回」的最小观察，若无埋点层则不做。
6. 一个方法两个版本与 `switch_method_release_v1`、`method_enrollments` 的配合方式。

## 与现有实现一致

- 有氧日 `day_type = cardio`；`record_shape = duration`；徒手俯卧撑 `bodyweight_reps`。
- 目标 RIR「还能再做约 2–3 次」对应已有 `actual_rir`。
- 提前结束保留已记录的组、不推进轮转；漏练不欠账（首页「本周训练 x/y」，休息日不算失败）。
- 不夸大承诺，与现有反馈文案和官网禁用词规则一致。
- 设备（Oura）数据与本方法无交集。

## 补丁自身已修正（相对 v0.5）

休息区间本方法独立声明为 60–90 秒；短版时长不再统一标称；小器械版 D 日不再依赖扶物（可扶稳固物保持平衡，为可选）；A–E 单字母 key 改为语义 key；§9 字段声明为概念，非契约。

## 官网与对外文案（CLAUDE.md）

本次不改 `lib/site/features.ts` 与官网。实现后：居家方法、教程入口在上线前不得当作已有功能；愿景只能带「规划中」；现有条目 `methods`（「三分化与四分化」）新方法上线时同步改文案；跑 `npx vitest run tests/site`。

## 落地顺序（待你确认，本次不做）

1. 器械等级字段 + 迁移 + 可用性判断 + 方法列表灰显/确认（A2，影响现有方法，先做并回归）。
2. 确定「一个方法两个版本」的数据实现方式。
3. 以 draft release 导入居家方法，不激活，内部灰度。
4. 短版开关、教程链接字段。
5. 教程链接核验（其他 agent 查 B 站，确认发布账号）后再放开链接与官网说法。

## 实施记录（2026-10-22）

已完成并提交（分支 `claude/serene-hopper-z5qtxu`）：

1. `20261022000100_method_equipment_requirement.sql`：`methods.required_equipment`（默认 `full_gym`，现有方法不变）；`switch_method_release_v1(release, start_day)` 允许没有在用方法的用户开始一个方法（用 onboarding 资料入组）。
2. 前端/接口：`lib/method-availability.ts` 新增 `evaluateMethodEquipmentFit`；`/api/method/library` 返回全部方法并带 `equipment_fit`，按「当前 → 匹配 → 不匹配」排序；`/settings/method` 不匹配的灰显、写明所需器械、点击后确认弹窗显示「该方法需要 xxx 才能执行，确定切换吗？」；首页「暂不可用」卡片对无默认方法的用户改为引导去选方法。
3. `20261022000200_home_five_session_methods.sql`：两个居家方法（各 5 个训练日、14 个动作、22 组模板），`validated` 未激活，所有处方标 `product_execution_default`。
4. `20261022000300_exercise_tutorial_link.sql` + 动作卡底部教程链接（仅 `tutorial_verified_at` 非空才显示）。
5. `supabase/tests/home_five_session_contract.sql`（已登记到 `validate-backend-package.mjs`）；`four_split_switch_contract.sql` 里「没有在用方法不能切换」的断言按新语义改为「既无在用方法也无 onboarding 资料才拒绝」。

验证：在本地 Postgres 16 上按顺序跑通全部迁移；新合同通过；居家用户从无在用方法开始，完整跑完五日循环（有氧日按 900 秒记录）并回到第 1 天；四分化起始日、四分化↔居家来回切换正常；缺 onboarding 资料被拒；现有 SQL 合同在新库上全部通过（仅 3 个因我的 `auth.users` 假表缺 `instance_id` 列而失败，基线库一样）；`vitest` 462 通过、`tsc`、`eslint` 无报错。

与初稿「待核」的对照：
- 短版 / 跳过动作阈值：现有「今天练多久」选择与「跳过动作」已经满足，不新增开关（见 v0.6 更新）。
- 一个方法两个版本：数据上是两个方法，沿用切换逻辑和历史保留；版本切换即方法切换。
- 未做：onboarding 完成后为居家用户**自动**入组（仍需用户在「训练方法」里选；`initialize_current_method_enrollment` 未改）；动作 GIF 映射（新动作暂无素材，按现有规则文字降级）；教程链接内容（字段已有，等其他 agent 查找后写入）；外跳返回后计时/草稿恢复（未验证）；前端未在浏览器里实际点过（本机没有 Supabase 环境）；两个居家方法未激活。
