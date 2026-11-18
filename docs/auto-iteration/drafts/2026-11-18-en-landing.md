# 英文落地页草稿（2026-11-18，只是草稿，不上线）

> 周计划 #53 周三用增任务。原计划按 11-15 锁定的「方向 A」（Know what to lift today）写；**xxa 11-17 否掉了 A、B，定下新方向「坚持容易、低摩擦」**（#70），所以本稿改用 #70 推荐的英文主句 E1。
> 写之前读过 `docs/marketing/MESSAGE_HOUSE.md` 和 #70 的两份文档。每一段后面写明靠的是 `lib/site/features.ts` 里哪条 `live` 功能。
> 这是一张**写明「英文版在做」的候补页**：英文界面今天还在开关后面（#67 #72），所以页面不能让人以为现在就能用英文。

## 用在哪里

- 官网英文版上线之前，作为 `/en`（或英文社区帖子里的链接）的候补页。
- 主要动作是**留邮箱，英文版好了通知你**，不是「立即开始」。复用现有种子登记表（`components/site/SeedForm.tsx` → `/api/seed-signup`），只换文案；要不要在登记里区分「英文用户」，周五放待批（需要加一个字段，算改线上结构）。

## 页面文案

### 顶部横条

> **English version in progress.** Pawside is live in Chinese today. Leave your email and we'll tell you when the English app is ready.

### Hero

**Make sticking with it the easy part.**

Open the app and your next workout is ready. Skip a week and it picks up where you left off. Nothing to make up, no streak to protect.

[ Tell me when English is ready ]（邮箱输入框 + 按钮）

依据：`today-plan`、`methods`（按完成进度轮转，不按日历）；App 里没有连续打卡天数（#70 已核对代码）。

> 注：#70 的 E1 副标题原文还有一句 "sized to the time you have"（30 / 45 / 60 / 90 分钟）。这个功能在 App 里有，但 `features.ts` 还没登记（周四任务登记）。**登记之前，官网不写这句**；登记合并后加回：
> "Open the app and your next workout is ready, sized to the time you have."

### 第二屏：断了也不掉队（最强的证据，按 #70 建议上提）

**Missed a few days? You don't start over.**

Your plan moves by sessions, not by calendar dates. If you train Monday and come back the following Thursday, you just do the next session. No catch-up workouts, no broken chain, nothing marked as failed.

依据：`methods`、`weekly-progress`（「休息日不算失败」）。

### 第三屏：今天练什么，已经排好

**Less to decide before you lift.**

- **Today's workout is ready.** Muscle groups, exercises, and a target for every set.
- **Every set says what it's for.** Warm-up or working set, and how many reps to aim for, right next to it.
- **Log as you go.** Enter your weight and reps after each set. Leave halfway and you'll continue where you stopped.

依据：`today-plan`、`set-guidance`、`set-logging`。

> 不写 "one tap"：次数不预填，要自己填（#70 核对过）。不写 "remembers what you lifted last time"：「上次」那一行是 #68 的方案，还没做。

### 第四屏：你自己定的一周

**Your week, your target.**

Set how many workouts you want this week. Home shows "2 of 3". Rest days are just rest days.

依据：`weekly-progress`。

### 第五屏：吃的（只写手动记录，不写一句话记录）

**Log meals without weighing everything.**

Write down what you ate. Pawside estimates calories and protein and shows a reference range for the day. It's a guide, not a grade.

依据：`meal-logging`、`nutrition-reference`。

> 不写小爪「说一句就记好」：小爪只回中文。也不写 AI 反馈：反馈目前是中文，英文版要改提示词、跑评测，属于新 AI 用途，要 xxa 批。

### 底部

**Pawside is free while we build it.** English is the next big step. Leave your email and you'll be among the first to try it.

[ Tell me when English is ready ]

## 不能写的（自查）

| 不写 | 为什么 |
|---|---|
| AI coach / personal trainer | MESSAGE_HOUSE：不说教练；英文 AI 反馈不存在 |
| "say it and it's logged" | 小爪只回中文 |
| 结果承诺（lose X kg, build muscle in N weeks） | MESSAGE_HOUSE 第 9 节 |
| photo logging、wearables | `features.ts` 里是 `planned` |
| "15 minutes" | 最短 30 分钟 |
| "free forever" | 定价没定；只说 "free while we build it" |

## 上线前要做的

1. xxa 批文案（对外内容）。
2. 选页面位置：`/en` 新页面，或官网加语言切换。新页面要在 `tests/site` 下加对应的英文红线检查（"AI coach"、"photo"、"Oura" 等）。
3. 周四「选今天练多久」登记进 `features.ts` 后，把 Hero 那一句加回来。
4. 种子登记要不要记「英文用户」：周五待批。
