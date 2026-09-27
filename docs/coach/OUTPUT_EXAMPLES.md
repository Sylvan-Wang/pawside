# 训练与饮食反馈：输出示例（给 Sylvan 检查）

依据的代码版本：`claude/coach-t4-output-v1-coachcard`，也就是 Cai 的 T4 提交 `a54e89a`。

**注意：**统一输出结构 `coach_output_v1` 默认是关的。要看到下面这种输出，Netlify 环境变量里得设 `PAWSIDE_COACH_OUTPUT_V1=1`；不设的话，模型仍然用旧结构（`summary` / `observations`）返回，页面显示的内容和下面差不多，只是没有行动类型。

**怎么检查：**看每个示例的第 3 部分（页面上最终长什么样），觉得哪里不对就直接批注在那一行。第 1、2 部分是给工程对照的：第 1 部分是模型拿到的内容，第 2 部分是模型必须返回的结构。

**关于示例数据：**训练示例用的是你 09-24 真实练的那次推；卧推之外的动作，以及具体的组数、次数、重量，都是编的，已标【示意】。饮食示例的数值是编的，但计算方法和代码一致。

---

## 示例一：训练结束后的反馈

**场景：**第 1 周期的推日。卧推按计划应该做 4 组（热身 + 12 / 10 / 8），只记录了前 3 组。侧平举 3 组休息-暂停全部完成【示意】。下一次训练是拉日。

### 1. 模型拿到的输入（`/api/ai/compose`，surface = `workout_session_feedback`）

| 字段 | 这次的值 | 从哪里来 | 模型可以拿它做什么 |
|---|---|---|---|
| `facts` | 完成动作数、完成组数、训练容量、时长 | `buildSessionFacts`（这些数字已经显示在页面卡片上） | 可以引用，但**不要复述** |
| `context.method.split_label` | `推` | `workout_sessions.split_key` | 知道这次练的是哪一天 |
| `context.method.exercises[]` | 每个动作一项，内容见下面代码块 | `exercise_executions` + `set_prescriptions` + `set_executions` | 按动作写反馈 |
| `context.method.prescribed_not_logged` | `[{ name: "杠铃卧推", prescribed: 4, logged: 3 }]` | 计划组数 − 实际记录组数 | 提醒"这次没有记录到"，不能说成"没完成" |
| `context.method.skipped` | `[]` | 被跳过的动作 | 只说明跳过了，不做评价 |
| `context.next_session` | `{ split_label: "拉", key_sets: [...] }`，内容见下面代码块 | 下一次训练的 `set_prescriptions` 里的关键组 | 写"下次训练怎么做"，不能新增重量或次数 |
| `context.data_issues` | `[]` | 时长异常等记录问题 | 非空时才写 `data_quality_tip` |
| `context.recovery_context` | 当天恢复自评的文字描述，或 `null` | `recovery_checkins` | 只作背景 |
| `context.allowed_actions` | `["complete_record", "view_next_session", "none"]` | 规则计算 | `action_type` 只能从这里面选 |

```json
"exercises": [
  {
    "name": "杠铃卧推", "status": "in_progress", "calibration": false,
    "prescribed_set_count": 4, "logged_set_count": 3,
    "key_sets": [],
    "last_time": { "top_weight_kg": 27.5, "reps": 12 }
  },
  {
    "name": "Y字侧平举", "status": "completed", "calibration": false,
    "prescribed_set_count": 3, "logged_set_count": 3,
    "key_sets": [
      { "set_index": 1, "label": "休息-暂停组", "target": "10 + 10 次", "effort": "做到接近或到力竭", "actual_reps": 20, "logged": true },
      { "set_index": 2, "label": "休息-暂停组", "target": "10 + 10 次", "effort": "做到接近或到力竭", "actual_reps": 20, "logged": true },
      { "set_index": 3, "label": "休息-暂停组", "target": "10 + 10 次", "effort": "做到接近或到力竭", "actual_reps": 18, "logged": true }
    ],
    "last_time": null
  }
],
"next_session": {
  "split_label": "拉",
  "key_sets": [
    "单手绳索下拉 第 4 组（休息-暂停组）：10 + 5 次，做到接近或到力竭",
    "单手器械划船 第 4 组（休息-暂停组）：10 + 5 次，做到接近或到力竭"
  ]
}
```

说明：
- 卧推没有关键组（`key_sets` 为空），因为按方法论主项不冲力竭。
- 侧平举第 3 组做了 18 次【示意】，用来演示"没做满"时模型该怎么说。

### 2. 模型必须返回的结构（`coach_output_v1`）

```json
{
  "headline": "卧推三组按节奏走完，侧平举很扎实",
  "primary_focus": {
    "signal_keys": ["training.completed_set_count"],
    "why_now": "主项完成情况最能代表今天"
  },
  "evidence": [
    {
      "text": "侧平举前两组做满 10 + 10，第三组 18 次，已经很接近",
      "signal_key": "training.completed_set_count",
      "status": "within_reference", "domain": "training_optimization", "evidence_ref_ids": []
    },
    {
      "text": "卧推第 4 组这次没有记录到",
      "signal_key": "training.record_completeness",
      "status": "insufficient_data", "domain": "data_quality", "evidence_ref_ids": []
    }
  ],
  "next_actions": [
    { "text": "下次拉：绳索下拉第 4 组加一点重量，做 10 + 5", "action_type": "view_next_session", "basis": "method" },
    { "text": "补上卧推第 4 组的记录", "action_type": "complete_record", "basis": "rule" }
  ],
  "data_quality_tip": null,
  "safety": { "level": "none", "text": null, "evidence_ref_ids": [] }
}
```

- 标题 ≤30 字；每条 evidence 最多 60 字；每个行动最多 40 字；训练反馈最多 2 条 evidence、2 个行动。
- 文案里出现的数字（10、5、18、4）都来自处方或实际记录，能通过数字检查。
- 下次训练那一条只复述 `key_sets` 里的内容。"加一点重量"出自方法论原文（末组"稍加一点重量"），不是模型自己加的。

### 3. 页面上长什么样（训练完成页）

```
今天的训练已记录
下一次继续拉训练。

完成动作 5   完成组数 17   训练时长 52 分钟   训练容量 3,120 kg      ← 事实卡片，规则算的【示意】

卧推三组按节奏走完，侧平举很扎实                                      ← headline
· 侧平举前两组做满 10 + 10，第三组 18 次，已经很接近                  ← evidence
· 卧推第 4 组这次没有记录到
[看下次训练]  下次拉：绳索下拉第 4 组加一点重量，做 10 + 5             ← 行动行（T8 之前只显示文字，没有按钮）
补记录         补上卧推第 4 组的记录

这次反馈有帮助吗？ 👍 👎
```

- 生成过程中，只显示"教练反馈生成中…"。
- AI 生成失败时，显示"基础总结 · AI 反馈暂时没有生成"，下面是规则卡片。

### 这些写法会被拦下，或者不应该出现

| 写法 | 原因 |
|---|---|
| "你今天练了 52 分钟，时间刚好" | 评价了时长（M008），而且复述了卡片上已有的数字 |
| "卧推没完成第 4 组" | "没完成"不能用（SCN-004 / 005），应该说"没有记录到" |
| "下次卧推可以加到 30 kg" | 一次做到不等于进阶（CAL-007）；处方里也没有 30 这个数字，数字检查会拦下 |
| "状态 partial，依据 AI Patch §8" | 内部用语，会被拦下后重试 |
| "今天练得太猛，注意过度训练" | 做了诊断（SCN-008 / 009） |

---

## 示例二：餐后反馈

**场景：**每日目标 2000 kcal、蛋白质 120 g。午餐分两次保存：第一次记了米饭和苦瓜炒蛋，第二次记了可乐鸡翅。早餐已经记过了。

### 1. 模型拿到的输入（surface = `meal_feedback`，需要带上 `meal_type: "lunch"`）

| 字段 | 这次的值 | 从哪里来 | 模型可以拿它做什么 |
|---|---|---|---|
| `facts` | 全天的目标 / 已摄入 / 剩余（热量和三大营养素）、`meal_count` | `buildNutritionFacts` | 可以引用，但不复述 |
| `context.this_meal.meal` | `午餐` | 餐次 | — |
| `context.this_meal.saves_merged` | `2` | 同一天同一餐次的保存次数 | 知道这是合并后的一整顿 |
| `context.this_meal.items` | `["米饭", "苦瓜炒蛋", "可乐鸡翅"]` | `user_food_log_items` | 可以点名说食物 |
| `context.this_meal.totals` | `{ calories_kcal: 742, protein_g: 37.2, carbs_g: 78, fat_g: 29 }` | 这一顿所有条目相加 | 这一顿吃了多少 |
| `context.this_meal.position` | `within` | 和参考范围比较后的结果（规则判断） | summary 直接用这个结论 |
| `context.meal_ref` | `{ calories_kcal: [600, 800] }` | `guidance.ts`：午餐占日目标的 30–40% | 参考范围，不是硬性要求 |
| `context.day` | 全天截至目前的已摄入和剩余（例如蛋白质还剩 62 g）、`is_today` | 全天汇总 | 说"还有空间"，一天没结束不下"不足"的结论 |
| `context.allowed_actions` | `["log_meal", "none"]` | 规则计算 | — |

### 2. 模型必须返回的结构（餐后最多 1 条 evidence、1 个行动）

```json
{
  "headline": "这顿午餐落在参考范围内，蛋白质也有着落",
  "primary_focus": { "signal_keys": ["nutrition.calories"], "why_now": "这一顿的量是用户最关心的" },
  "evidence": [
    {
      "text": "鸡翅和鸡蛋是这顿的主要蛋白质来源，全天还有 62 g 的空间",
      "signal_key": "nutrition.calories",
      "status": "within_reference", "domain": "user_target", "evidence_ref_ids": []
    }
  ],
  "next_actions": [
    { "text": "晚餐加一份蛋白质，比如鱼或豆腐", "action_type": "log_meal", "basis": "rule" }
  ],
  "data_quality_tip": null,
  "safety": { "level": "none", "text": null, "evidence_ref_ids": [] }
}
```

- 现在只有热量有信号，所以 evidence 暂时挂在 `nutrition.calories` 上。T6 会加上蛋白质信号，之后这一条改挂 `nutrition.protein`。
- 举例的食物不超过 2 个，也不写克数。

### 3. 页面上长什么样（饮食页，按新流程）

```
今天                                                    还可摄入 1,020 kcal · 蛋白质 62 g
─────────────────────────────────────────────
早餐   燕麦牛奶 · 鸡蛋                                   420 kcal · 蛋白质 21 g
午餐   米饭 · 苦瓜炒蛋 · 可乐鸡翅                         742 kcal · 蛋白质 37 g   参考 600–800
       [+ 加到午餐]
晚餐   还没记                                            [记晚餐]
加餐   还没记
─────────────────────────────────────────────
本餐反馈
这顿午餐落在参考范围内，蛋白质也有着落
· 鸡翅和鸡蛋是这顿的主要蛋白质来源，全天还有 62 g 的空间
[记一餐]  晚餐加一份蛋白质，比如鱼或豆腐
```

- 可乐鸡翅是第二次保存的，现在和前两样一起出现在午餐里。
- 每个食物默认只显示热量和蛋白质，点开才看得到碳水和脂肪。
- 页面现在还没有这个今日餐单视图，是这次 patch 的 B1 要做的。

### 这些写法会被拦下，或者不应该出现

| 写法 | 原因 |
|---|---|
| "午餐 742 kcal，蛋白质 37.2 g" | 复述了卡片上的数字 |
| "你吃得太晚了" | 不评价吃饭的时间 |
| "今天蛋白质不足" | 一天还没结束，不下全天的结论 |
| "明天少吃一点补回来" | 不做跨天补偿 |
| "晚餐吃 150 g 鸡胸肉" | 不给克数 |
