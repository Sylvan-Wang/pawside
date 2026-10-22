# 居家轻力量 v0.5 补丁 × 现有实现｜冲突检查

检查日期：2026-10-22。对象：`PATCH_v0.5_review.md`（sha256 `949695372499f0579dae14090a19fe4470a538e2fad972c7879f570da0266c5a`，状态：待内容验收的审阅稿）。
基线：`master` e6488cd，已有 `ksw_tcy_three_split_2026` 与 `four_split_2026` 两套方法。

范围与方式：只读 migrations、`lib/contracts/onboarding.ts`、`lib/method-availability.ts`、`lib/method-catalog.ts`、`lib/site/features.ts`、`app/training`、`app/workout`。**没有跑应用，也没有读完所有运行时函数**；标「待核」的条目需要实现时再确认。本次不改数据库、前端、官网。

关系：补丁作为**新增并存**的方法（建议 `methods.key = home_five_session_2026`，补丁里的 `pawside_home_five_session_b` 不符合现有 key 命名习惯，导入时再定）。现有两套方法不变。

## 结论

补丁的大方向与现有结构**兼容**：多日 split、`day_type = cardio`、`bodyweight_reps` / `duration` 记录形态、提前结束不推进轮转、漏练不欠账（首页是「本周训练 x/y」，休息日不算失败）、GIF 主展示，都能承接。

但有 **4 个真冲突**（必须先定方案）和若干需要扩展的缺口。

## A. 真冲突

| # | 补丁说法 | 现状 | 影响 / 建议 |
|---|---|---|---|
| A1 | 场地多选、器械按场地多选、未填不等于「无器械」（§3C） | onboarding 只有**单值** `equipment_access ∈ {full_gym, basic_equipment, home_bodyweight}`，且被 SQL 检查约束、`save onboarding` RPC、`app/onboarding/page.tsx` 三处写死 | 新字段要**加**不要改旧：保留旧枚举作兼容/派生值，新增场地与器械字段。补丁的「未填 ≠ 确认无器械」与现状「必选一项」冲突，需决定旧用户（已选 home_bodyweight）如何迁移 |
| A2 | 纯徒手内容对所有人可见，有器械只是增加选择（§3C 规则 3） | `evaluateMethodAvailability` 把 `equipment_access !== 'full_gym'` 一律判为 `EQUIPMENT_REVIEW_REQUIRED`，**所有方法**对非健身房用户都不可用；提示语写死「三分化」 | 可用性必须改成「按方法声明的器械要求」判断，而不是全局只认 full_gym。否则新方法上线后居家用户仍进不去。会动到现有两套方法的门禁，需回归测试 |
| A3 | 「自由组合」复用已有 add / remove / reorder / duplicate / replace（§3A、§9） | 现有方法执行里没有这组能力：训练处方由生成器按 release 产出；仅有的 `adjustments`（换动作、隐藏、跳过某天）是**灰度功能**；`/workout` 自由训练是独立流程，不属于方法处方 | 补丁的前提「已有」不成立。要么缩小范围（先只做 replace / 跳过，复用 adjustments），要么把自由组合明确列为新开发。官网不得提前写成已有 |
| A4 | 自由训练不推进五日循环；从模板进入并改动后结束时可选「计为本次模板训练 / 另存自由训练」（§3A） | 推进由 `complete_method_session_v2` 决定；`end_method_session_early_v1` 保留记录但不完成当天、指针不变；没有「另存为自由训练」这条出口 | 指针推进语义可复用，但「另存自由训练」需要新增（把 session 转成 `workout_logs`）。待核：改动模板后的 session 现在是否仍按原处方计完成 |

## B. 需要扩展（不冲突，但现在做不到）

1. **左右侧记录**：补丁要求两侧各自完成量、两侧完成才算一组。`set_executions` 没有 side 概念。分腿蹲、侧卧抬腿、死虫式、鸟狗式都依赖它。
2. **器械类型与阻力**：补丁区分短环带 / 长带 / 哑铃，并记录阻力；`exercises.equipment` 是文本数组，没有「哪种带」「阻力档」字段。
3. **教程弱链接**：动作详情底部放官方教程链接，需要新字段（来源、是否已核验、可选时间戳）。`exercise_external_mappings` 是 GIF 素材映射，**不能**复用来放教程（补丁也要求二者分别保存出处）。
4. **短版是独立处方**：补丁要求「短版完成」为单独状态。现有只有「提前结束」，语义不同（提前结束不算完成当天）。需要新的完成类型与每个模块的短版组次。
5. **动作素材覆盖**：现有素材来自 `@bryllim/workout-guide`（CC BY-SA 4.0，需署名）。BW 模块里的跪姿俯卧撑、俯卧 W 抬臂、反向雪天使、死虫式、鸟狗式、侧卧抬腿是否在库里，**待核**；缺素材时按补丁和既有规则降级为文字提示，不阻塞发布。
6. **外跳恢复**：补丁要求外跳前持久化、返回后计时保持暂停。现有有 `training-draft-store`、`training-offline-queue`、会话时长接口，覆盖程度**待核**。
7. **split key**：现有正则 `^[a-z][a-z0-9_]{1,31}$`，补丁的 A–E 单字母不合法。需要用语义 key（如 `glute_leg_base`、`upper_base`、`comfort_cardio`、`glute_leg_extra`、`upper_core`）；`order_index` 上限 12，够用。
8. **埋点**：补丁事件（`tutorial_open` 等）能否复用现有埋点系统**待核**，本次未找到明确的通用埋点层。

## C. 一致或可直接承接

- 有氧日：`method_splits.day_type = cardio`；`record_shape = duration / distance_duration` 已有，跑步机与踏步可用。
- 徒手俯卧撑类：`bodyweight_reps` 已有。
- 目标 RIR 提示（「还能再做约 2–3 次」）对应已有 `actual_rir`。
- 提前结束保留已记录组，不推进轮转 → 与补丁「漏做不欠账、部分完成可保存」一致。
- 补丁拒绝治疗/减脂/热量夸大承诺，与现有反馈文案、官网禁用词规则一致。
- 设备（Oura）数据：补丁与之无交集，不涉及 AI 引用限制。

## D. 补丁自身需要先改的地方

1. **休息区间**：补丁统一 60–90 秒；现有四分化 / 三分化模板多为 45–90 秒。不同方法允许不同，但要在 release 里写明，不要让同一个 UI 文案互相矛盾。
2. **短版时长不一致**：§3B「不将短版一概标为 15 分钟」，§9 又写「短版约 15–20 分钟」。以前者为准，§9 建议改为「按模块累计」。
3. **器械版 D 日用「扶物分腿蹲」**：依赖稳固支撑，但 §3C 把墙面/稳固支撑定义为用户主动选择的辅助分支。器械版默认处方应写成不依赖扶物，或把「稳固支撑」列为该模块的必需条件。
4. **§9 字段是概念，不是契约**：补丁自己已声明未对齐仓库契约。导入前需按 `method_releases / method_splits / method_rules / method_runtime_set_templates` 的真实列重写，不能直接导入。
5. **素材核验未完成**：Z01/Z02/P01–P03 未完整播放，教程关联必须保持「候选」，不能上线。

## E. 官网与对外文案（CLAUDE.md 要求）

本次只落文档，**不改** `lib/site/features.ts` 与官网。以后实现时再按规则处理：
- 居家方法、场地/器械档案、自由组合、教程入口，上线前一律不得出现在官网当作已有；愿景只能带「规划中」。
- 现有条目 `methods`（「三分化与四分化」）在新方法上线时要同步改文案。
- 跑 `npx vitest run tests/site`。

## F. 建议的落地顺序（待你确认，本次不做）

1. 先定 A1–A4 的方案（尤其 A2：可用性按方法声明的器械要求判断）。
2. 补丁按 D 修订，并对齐真实契约。
3. 数据层：场地/器械字段、side 记录、教程链接字段、短版完成类型。
4. 以 draft release 导入新方法，不激活；内部灰度（`app_features`）后再放开。
5. 完成 Z01/Z02/P01–P03 的核验与试跑，再谈教程链接和官网。
