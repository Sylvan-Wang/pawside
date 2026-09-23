# Pawside 2.0｜Open Questions

> 更新日期：2026-09-04  
> 原则：这里记录会改变数据、规则、UI 或 migration 的真实冲突与未锁定项；未解决前不自行选择方案。

## OQ-001｜最终 Method Tracking 数据尚未提供

- 状态：`BLOCKING_PHASE_1_RULE_SEED`
- 范围：Method Rule、Progression State、首份完整 Push Prescription、Pull/Legs Template。
- 当前代码：
  - 已创建 versioned Method/Rule/Prescription schema；
  - 官方方法只以 `draft` 存在；
  - 只保存 PRD 已明确的 5 个 Push 动作身份；
  - 未写入 role、rule key、stage、sets、progression transition 或可执行处方。
- 需要的权威输入：最终 Tracking 表的完整行、字段定义、版本和确认状态。
- 影响：
  - 数据：不能创建可追溯的初始 progression state；
  - API：`POST /api/onboarding` 可以保存基础 profile，但必须返回 Method `unavailable`，且不能形成半完成 enrollment；
  - UI：用户可以进入现有 Pawside Home/记录功能，但不能进入伪造的可执行 Day 1；
  - Migration：method seed 不能改为 `active`。

## OQ-002｜卧推首阶段组次需要 Tracking 判定

- 状态：`NEEDS_TRACKING_CONFIRMATION`
- PRD 证据：处方示例出现 warm-up 15、working 12 / 8 / 8。
- System Spec 证据：JSON DSL 的形式示例出现 warm-up 15、working 12 / 10 / 8，并明确说明该示例不能当最终 stage。
- 原始 txt 证据：第 182–210 行描述首组热身 15，后续正式组 12 / 10 / 8，保留约 2 次余量（约 RPE 8）；第 223–298 行继续描述后续 stage 序列。
- 两种可能方案：
  1. Tracking 确认首阶段为 15 / 12 / 10 / 8；
  2. Tracking 确认 PRD 示例 15 / 12 / 8 / 8 属于某一具体 cycle/stage，而非首阶段。
- 影响：Set Prescription、首份 Push Day 1、当前 stage key、后续 progression event 全部不同。
- 决策：等待 Tracking；不得从原始 txt 单独定案。

## OQ-003｜Pull / Legs 动作名称与 canonical mapping

- 状态：`NEEDS_TRACKING_CONFIRMATION`
- 原始 txt 候选（只作核对，不落 Method Template）：
  - Pull：单手绳索/钢线下拉、对握下拉、单手器械划船、坐姿开肘划船、绳索/钢线弯举；
  - Legs：单腿硬拉、保加利亚蹲、颈前深蹲、罗马尼亚硬拉、山羊挺身。
- 当前代码：上述动作尚未写入 `method_split_exercises`。
- 待确认：Tracking 的 canonical name、别名、动作顺序、method role、替代/退阶规则。
- 影响：Exercise ID mapping、外部视觉素材匹配、rule key、处方顺序。

## OQ-004｜恢复与训练频率不能从口播直接固化

- 状态：`NEEDS_RULE_LOCK`
- 原始 txt 语境：第 651–695、1201–1381 行强调按个体恢复决定休息，包含睡眠、主观状态、晨脉、握力、HRV 等讨论；不同说话段落对连续训练天数也有个体化表达。
- 已确认产品输入：V1 用户输入仅为睡眠、整体疲劳、明显疼痛/关节不适，且不每日强制。
- 两种可能方案：
  1. Tracking/Recovery Spec 给出只依赖 V1 三问的确定性规则；
  2. 晨脉/HRV/握力仅预留未来来源，不进入 V1 decision truth。
- 影响：Recovery schema、decision rule、rest-deferred 状态、Home 文案。
- 决策：不从原始 txt 增加 V1 必填字段或阈值。

## OQ-005｜动作执行提示的产品化粒度

- 状态：`NON_BLOCKING_NEEDS_CONTENT_REVIEW`
- 原始 txt 含大量动作提示、呼吸、节奏、关节与退阶语境，可作为 explanation/source note 证据。
- 待确认：Tracking 是否已有 cue 字段与审核文本；若为空，是否由内容审核后写入既有 `method_notes` / rule explanation，而不是新增产品字段。
- 影响：Workout UI 的提示长度、医疗/伤病边界、内容审核和来源标注。
- 决策：Phase 1 不把口播原句直接写成数据库规则或医疗结论。
