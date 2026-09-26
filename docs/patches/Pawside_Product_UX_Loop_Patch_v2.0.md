# Pawside Product & UX Loop Patch v2.0
**版本：v2.0｜2026-09-26**
**性质：产品层 / UX 层 Patch**
**适用：现有 Pawside，不重做底层训练方法论，不重建食物数据库，不把 AI 当成产品真值层**

---

# 0. 本 Patch 解决什么

这份 Patch 只回答：

> 用户在 Pawside 里看到什么、输入什么、什么时候出现、数据如何被组织成一个连续的产品体验。

它不负责回答：

- “蛋白质合理值为什么是这个值”
- “训练量偏高是怎么算的”
- “AI 为什么给出这条建议”
- “哪个指南支持这个阈值”

这些统一由配套文档 **《Pawside AI Intelligence & Evidence Patch v1.0》**负责。

本 Patch 的目标是把当前分散的 Onboarding、训练记录、饮食记录、Daily Review、History、Weekly、Home Dashboard 收敛成一条完整闭环：

```text
首次设置目标
   ↓
每日轻量 Check-in
   ↓
训练 / 饮食记录
   ↓
即时反馈
   ↓
Daily Log
   ↓
Weekly Log
   ↓
下一步行动
```

产品原则：

> **Record → Understand → Review → Adjust**

---

# 1. 当前产品基础：保留什么、替换什么

## 1.1 保留

现有 Pawside 已经有：

- 新用户 Onboarding
- 减脂 / 增肌 / 保持
- 性别
- 身高
- 体重
- 每周训练目标
- 每日热量目标
- Workout Log
- Food Log
- Body Metrics
- Home Dashboard
- History
- Weekly
- Daily Review

这些不重新造。

## 1.2 替换 / 升级

原 Home Popup：

```text
每次打开 Home
→ 今天想做什么？
→ 记录训练 / 记录饮食
```

这个 Popup 只承担导航，不产生新的用户信息。

v2 将其替换为：

> **每日最小 Recovery Check-in**

记录训练 / 饮食入口仍保留在 Home 和对应页面，不再需要用强制弹窗承载。

---

# 2. Product IA：四层体验

## Layer 1 — Target

用户决定自己希望往哪里走：

- 健身目标
- 每周训练目标
- 每日热量目标

系统补充：

- 每日蛋白质建议
- 每日碳水建议
- 每日脂肪建议

## Layer 2 — Record

用户记录当天发生了什么：

- Workout
- Food
- Body
- Recovery Check-in

## Layer 3 — Immediate Feedback

一次行为完成后马上回答：

> “刚刚这一次意味着什么？”

包括：

- Workout Session Feedback
- Meal Feedback

## Layer 4 — Log

把碎片行为组织成时间上的连续故事：

- Daily Log
- Weekly Log

---

# 3. Onboarding 2.0

## 3.1 保留已有字段

继续使用：

```text
目标
- 减脂
- 增肌
- 保持

性别
身高
体重
每周训练目标
```

不重新设计另一套 Nutrition Onboarding。

---

# 4. Nutrition Target：用户只设置 Calories

用户唯一必须主动决定的 Nutrition Target：

```text
每日热量目标（kcal）
```

例如：

```text
你的每日热量目标

[ 1800 ] kcal

系统会根据你的身体数据和训练目标，
生成蛋白质、碳水和脂肪的每日参考目标。

[继续]
```

## 4.1 Macro Target 不再要求用户手填

系统生成：

```text
每日蛋白质建议
每日碳水建议
每日脂肪建议
```

UI：

```text
每日营养参考

热量
1800 kcal        你的目标

蛋白质
120 g            系统建议

碳水
190 g            系统建议

脂肪
62 g             系统建议

[为什么是这些数？]
```

产品语义必须区分：

```text
Calorie Target
= 用户明确设置的目标

Macro Recommended Target
= 系统根据用户资料生成的参考值
```

Macro 不是每日强制限制。

## 4.2 用户吃多 / 吃少仍由用户决定

例如：

```text
蛋白质建议：120g
实际：136g
```

默认不能直接显示：

> “蛋白质摄入不合理”

必须由 Evidence/Interpretation 层判断是否真的存在可支持的风险或异常。

同理，碳水或脂肪超过系统建议，也不自动等于“不健康”。

Pawside 提供参考和解释，不代替用户做饮食决定。

---

# 5. Calorie Safety Warning

Nutrition Target 和 Safety Warning 是两个系统概念。

```text
用户目标
≠
安全 / 风险参考
```

## 5.1 Onboarding / Settings

用户输入热量目标后，系统返回：

```text
normal
caution
warning
not_assessable
```

当满足警示条件：

```text
每日热量目标
[ 900 ] kcal

⚠ 这个目标低于当前可用身体信息推算出的参考范围。
长期维持较低能量摄入可能不适合所有人。

[为什么会提示？]

[修改目标]
[仍使用这个目标]
```

原则：

- 不直接阻止保存
- 不替用户决定
- 必须提供 reference
- 必须说明是“估算 / 参考”，不能假装医学诊断

## 5.2 Daily Log

如果当天已记录摄入触发同类警示：

```text
⚠ 今日记录的能量摄入偏低

根据当前已记录饮食，你今天的摄入低于参考线。

[为什么会提示？]
```

但必须考虑记录完整度。

如果用户可能没有记全：

> 当前**已记录**摄入低于参考线；如果还有未记录饮食，本判断可能不完整。

禁止把“不完整记录”直接解释成“实际吃得过少”。

---

# 6. Recovery Check-in V1

## 6.1 定位

Recovery V1 不是完整睡眠产品。

本期明确不做：

- 睡眠阶段
- HRV
- 静息心率
- 穿戴设备
- Apple Health
- 精确睡眠 tracker
- 恢复总分

只采集两个主观信号。

## 6.2 两个问题

### Q1

> 昨晚睡得好吗？

```text
1 很差
2 较差
3 一般
4 不错
5 很好
```

字段：

```text
sleep_quality_self_report: 1–5
```

### Q2

> 上一次训练后恢复得怎么样？

```text
1 很差
2 较差
3 一般
4 不错
5 很好
```

字段：

```text
post_workout_recovery_self_report: 1–5
```

这两个值只是用户自评，不是医学测量。

---

# 7. Recovery Check-in Trigger

替代旧 Home action popup。

产品语义：

> 每个本地自然日最多一次，用户第一次进入主要使用流程时轻量询问。

推荐触发：

```text
首次进入 Home / Training
AND 今日未完成 check-in
→ 弹出
```

必须满足：

- 每天最多 1 次
- 可跳过
- 不阻塞训练
- 不因为关闭 App 再次反复弹
- 当天回答后不再弹

如果用户从未训练过：

- 显示睡眠问题
- Recovery 问题可隐藏或标记“不适用”

## 7.1 Popup

```text
今天状态怎么样？

昨晚睡得好吗？
○ 很差  ○ 较差  ○ 一般  ○ 不错  ○ 很好

上一次训练后恢复得怎么样？
○ 很差  ○ 较差  ○ 一般  ○ 不错  ○ 很好

[查看昨日训练记录]

[完成]
```

如果昨日无训练但存在更早训练：

```text
[查看上次训练]
```

---

# 8. Recovery 的产品边界

Recovery 自评不能单独产生：

```text
今天禁止训练
训练量必须降低 40%
你过度训练了
```

允许的基础表达只有：

```text
今日自评恢复较低
今日自评恢复一般
今日自评恢复较好
```

是否因此调整训练处方，由 AI/Evidence Patch 中独立规则决定。

---

# 9. Meal Feedback

## 9.1 Trigger

```text
保存饮食成功
→ 更新当天 intake
→ 更新 Nutrition Budget
→ 展示 Meal Feedback
```

不再：

```text
保存
→ Toast
→ 1.2 秒后直接 Home
```

Toast 仍只负责确认：

> 保存成功

完整 Feedback 使用 Result Card / Bottom Sheet。

---

# 10. Meal Feedback：UI 不提前写 AI 答案

上一版曾使用：

> “晚餐优先补蛋白质，脂肪可以稍微控制一点。”

这一类句子不是现有规则，也不是已定义 Prompt。

v2 不把示例答案当产品需求。

UI 只定义它需要什么：

```text
记录好了

今日热量
Consumed / Target

蛋白质
Consumed / Recommended

碳水
Consumed / Recommended

脂肪
Consumed / Recommended

[系统解释区域，可为空]

[查看为什么]
[完成]
```

## 10.1 Facts 必须始终先于建议

Meal Feedback 优先级：

### 1. Facts

```text
target
consumed
remaining
```

### 2. Status

例如系统已经有可靠规则时：

```text
within_reference
below_reference
above_reference
insufficient_data
```

### 3. Explanation

只有 Facts + Status 足够时才生成。

---

# 11. Food Equivalent

P1。

入口：

> 看看还可以怎么吃

产品目标：

> 把抽象数字转换成用户理解的食物量。

所有数值由 deterministic calculation 提供。

UI 不允许 AI 自己生成克数。

---

# 12. Workout Session Feedback

## 12.1 Trigger

自由训练：

```text
Workout Save
→ Workout Result
```

Method Workout：

```text
Complete Session
→ Workout Result
```

一次 session 一份结果。

一天练两次：

```text
Session A → Feedback A
Session B → Feedback B
```

Daily Log 再聚合。

---

# 13. Workout Result UI

不再预设“今天整体完成度不错”等未经规则支持的文案。

分三层。

## Layer A — Session Facts

只有数据库中真实存在的内容：

```text
训练类型
训练时间
完成动作数
sets / reps / weight / RIR（如有）
Method split（如有）
cycle / next split（如有）
```

## Layer B — Computed Signals

只有规则能够确定时展示：

```text
duration status
record completeness
plan adherence
progression signal
data quality
```

## Layer C — AI Feedback

由 AI Patch 定义 Prompt 和输出。

UI 只保留容器：

```text
本次训练

[Session Facts]

[AI / Rule Feedback]

下一步
[0–2 条可执行建议]

[完成]
```

如果 AI 不可用：

→ Facts 仍正常显示。

---

# 14. 👍 / 👎 不作为装饰组件

P0 可以不展示。

只有当后端能够同时保存：

```text
feedback_content_id
scope_id
prompt_version
model_version
input_snapshot_version
user_rating
timestamp
```

之后才上线。

否则它只是漂亮但没有产品闭环的按钮。

---

# 15. Daily Log：正式产品对象

当前 History / Daily Review 可以演进成 Daily Log，不要求新增底部 Tab。

Daily Log 的产品定义：

> 一天的客观记录 + 数据图表 + 文字复盘。

---

# 16. Daily Log Structure

```text
DATE NAVIGATION

↓
Daily Dashboard

↓
Recovery

↓
Workout Logs

↓
Food Logs

↓
Body Data（有则显示）

↓
Daily Review

↓
Next-day Guidance
```

## 16.1 Date Header

```text
← 9/25     9/26 今天     9/27 →
```

支持：

- swipe
- tap date
- calendar entry（可后续）

## 16.2 Daily Dashboard

### Workout

- 当日训练次数
- 训练时间
- session 类型
- 计划完成情况（若可计算）

### Nutrition

- kcal consumed / target
- protein
- carb
- fat

### Body

只有存在数据时展示。

### Recovery

```text
昨晚睡眠感受  4/5
训练后恢复    3/5
```

不生成“恢复健康分”。

---

# 17. Raw Daily Logs

图表下面必须同时有可读的文字记录。

例如：

```text
训练
14:20  Push
52 分钟
6 个动作
[查看]

饮食
08:30 早餐
12:40 午餐
19:10 晚餐
[查看]
```

目标：

Dashboard 回答“整体怎么样”。

Raw Log 回答“今天到底发生了什么”。

---

# 18. Daily Review

Daily Log 中的文字复盘至少需要三个区块：

```text
今日总体评估

值得注意

明日建议
```

Daily Review 是一个生成结果。

Product Patch 不规定它必须说什么。

AI Patch 负责定义：

- 输入
- Rules
- Evidence
- Prompt
- JSON Contract

---

# 19. “今天”与“历史日”状态不同

## Today

当天还没结束：

标题：

> 今日状态 · 截至目前

不能假装是完整日终总结。

## Historical Day

过去日期且数据稳定：

> 9 月 25 日 Daily Log

允许显示持久化后的完整 Daily Review。

---

# 20. Daily Log 邻近日预加载

用户浏览高频行为通常是：

```text
昨天 ↔ 今天 ↔ 明天 / 下一个计划日
```

产品要求：

进入 Day N 时：

```text
Day N-1 READY
Day N ACTIVE
Day N+1 READY / plan-ready
```

目标不是强制指定 cookie / sessionStorage 技术。

目标是：

> 用户切相邻日期时，不应该每次重新等待完整页面和 AI 生成。

---

# 21. Cache UX

采用产品语义：

```text
cached result
→ immediate render
→ background refresh
→ changed data silently update
```

任何当天 mutation：

```text
workout add/edit/delete
food add/edit/delete
body update
target update
recovery check-in
```

必须使相关 Today Log 标记 stale。

不能出现：

> 食物已经保存，但 Daily Log 还是保存前结果。

---

# 22. Weekly Log

Weekly Log 不等于 7 个 Daily Review 拼起来。

定义：

> 用一周窗口展示单日无法看出的趋势。

视觉权重必须大于 Daily Log。

---

# 23. Weekly Log Structure

```text
WEEK RANGE

↓
Weekly Hero Summary

↓
Training Trend

↓
Nutrition Trend

↓
Body Trend

↓
Recovery Trend

↓
Weekly Review

↓
Next-week Guidance
```

## 23.1 Training Trend

根据当前真实可计算数据逐步展示：

- 训练次数
- 总训练时间
- muscle-group volume（有可靠映射才显示）
- Method adherence（有可靠规则才显示）

不得为了填满 Dashboard 伪造指标。

## 23.2 Nutrition Trend

- kcal daily trend
- protein daily trend
- carb daily trend
- fat daily trend
- 低于 / 高于 reference 的天数（只有 Evidence Engine 支持时）

## 23.3 Body Trend

继续复用已有 body_metrics。

例如：

- weight trend
- available measurements

## 23.4 Recovery Trend

只有 V1 两个 subjective signal：

```text
平均睡眠感受
平均训练后恢复感受
回答天数
```

不展示：

> 恢复分 82

---

# 24. Weekly Review

必须回答趋势问题，而不是逐日复述。

输出槽位：

```text
本周发生了什么

最明显的趋势

值得注意的问题

下周建议
```

AI 逻辑由 AI Patch 定义。

---

# 25. Evidence UX：所有“合理性判断”都能解释

凡 UI 出现：

```text
偏低
偏高
达到建议
低于建议
值得注意
风险
```

旁边必须支持：

`?`

## 25.1 Explanation Sheet

```text
为什么这样判断？

你的数据
本周：XXX

参考
一般成年人：XXX

Pawside 判断
XXX

适用范围
XXX

来源
WHO / 国家卫健委 / ACSM / ...

[查看来源]
```

## 25.2 不同证据的文案强度不同

Guideline：

> 低于一般成年人建议范围

Research / Professional Consensus：

> 低于常见训练参考范围

Pawside 自定义：

> Pawside 根据你的近期记录评估为……

不得：

> 医学上不合理

---

# 26. Home 的角色

Home 不需要承载所有分析。

Home 是：

> 今天的控制台。

保留：

- 今日训练
- 今日营养
- 本周进度
- 体重趋势
- Daily Log 入口

完整复盘进入 Daily Log。

完整趋势进入 Weekly Log。

---

# 27. Error / Empty State

## Recovery 未填写

```text
今日未记录主观恢复
```

不补默认 3/5。

## Nutrition Target 未设置

展示 consumed，不展示假 target。

CTA：

> 设置每日热量目标

## Macro Recommendation 未生成

不阻塞 Food Log。

## AI Review 未生成

Facts / Charts / Logs 仍然完整可用。

## 数据不足

显示：

> 数据还不够，继续记录后再判断趋势。

不能让 AI 填空。

---

# 28. Product Priority

## P0

1. Onboarding Nutrition Target UX
2. Macro recommendation display contract
3. Calorie caution UI contract
4. Recovery Check-in V1
5. Meal Feedback container
6. Workout Result container
7. Daily Log IA
8. Adjacent-day preload UX
9. Weekly Log IA
10. Evidence `?` component
11. Cache invalidation semantics

## P1

1. Food Equivalent
2. Weekly richer training volume
3. Feedback rating
4. richer evidence details
5. manual macro override（如验证确有需求）

## P2

1. Wearables
2. objective recovery data
3. advanced sleep
4. automatic training adjustment
5. validated Pawside composite score

---

# 29. Acceptance Criteria

### AC-P01
新用户只需要主动输入 daily calorie target，不要求手填三宏量。

### AC-P02
Macro recommendation 明确标记为“系统建议”，不包装成用户自己设置的限制。

### AC-P03
Safety Warning 与普通 macro target status 是两个独立状态。

### AC-P04
Daily actual calorie warning 会考虑 food log completeness，不把未记全误判成真实低摄入。

### AC-P05
Recovery Check-in 每个本地日最多出现一次，可跳过，不阻塞记录训练/饮食。

### AC-P06
Recovery V1 只有两个 subjective inputs，不创建假“恢复分”。

### AC-P07
Food save 后能立即看到最新 nutrition facts / budget，不必须先进入 History。

### AC-P08
Workout 完成后首先显示真实 session facts；AI 不可用时页面仍成立。

### AC-P09
同日多个 workout session 可各自拥有 Result / Feedback。

### AC-P10
Daily Log 同时包含 Dashboard 与文字 Raw Logs。

### AC-P11
Daily Log 中 Today 必须标记“截至目前”，不能与完整历史日混淆。

### AC-P12
用户切换相邻日期时优先从已准备数据即时展示，而不是每次等待 AI 重新生成。

### AC-P13
Weekly Log 展示趋势，不复制粘贴七份 Daily Review。

### AC-P14
所有“偏低 / 风险 / 达标”等判断都能通过 `?` 查看依据。

### AC-P15
没有足够证据的数据不展示伪评价。

---

# 30. 与 AI Patch 的接口边界

Product Patch 只要求 AI/Rule 层返回：

```ts
type InterpretedMetric = {
  metric_key: string
  value: number | string | null
  status:
    | "within_reference"
    | "below_reference"
    | "above_reference"
    | "caution"
    | "warning"
    | "insufficient_data"
    | "not_assessable"
  explanation?: string
  evidence_ref_ids?: string[]
}
```

Product 不自行解释医学 / 训练学阈值。

---

# 31. 需要产品确认但不阻塞 IA 的一项依赖

如果 Calorie Safety Warning 最终采用基于 RMR/BMR 的个人估算：

> 当前 Onboarding 缺少年龄。

因此必须二选一：

### A
Onboarding 增加：

```text
年龄 / 出生年份
```

### B
不做个体化 RMR/BMR 警戒线，只做适用人群明确的通用 guideline warning。

禁止在没有年龄的情况下偷偷使用一个看似精确的个人 BMR 公式。

---

# 32. 最终产品闭环

```text
Onboarding
用户目标 + 系统参考
        ↓
Recovery Check-in
        ↓
Workout / Food
        ↓
Immediate Result
        ↓
Daily Log
        ↓
Weekly Log
        ↓
下一次训练 / 饮食决策
```

Pawside 的核心不再只是“记录器 + AI 总结”。

而是：

> **每一次记录都有上下文，每一天形成 Log，每一周形成趋势；所有判断都有依据，但最终决定仍在用户。**
