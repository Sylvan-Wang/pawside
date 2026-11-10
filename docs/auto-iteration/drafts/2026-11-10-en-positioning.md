# 英文定位一句话：方向 A、B 各 3 版（草稿）

> 周计划 #30 周三的用增任务，周二提前做。只是草稿，不发布。周五决策场请 xxa 选方向。
> 写之前读过 `docs/marketing/MESSAGE_HOUSE.md`（价值 → 画面 → 证据 → 机制；不写没做的功能；不承诺结果）。
> 每版后面注明它靠的是哪条已上线功能（`lib/site/features.ts` 里的 id），以及证据来自哪条信号 issue。

## 先说清的前提

1. **App 目前只有中文界面。** 这些句子只能用在两个地方：英文界面上线之后的英文官网；或者上线前的英文候补名单页（页面上要写明 "English version in progress"，不能让人以为今天就能用英文）。
2. 单位：App 里是公斤和千卡。英文文案里不出现 lb、oz，直到换算做完（#29 的检查项：换算后热量目标不能低于安全下限）。
3. 两个方向都不说 "AI coach"。信号里 AI 两头都有反面：有人嫌 MyFitnessPal 新的 AI 记录更麻烦（#27 的 11-09 补充），有人嫌 Fitbod 的 AI 排课「不懂人体」（11-10 信号包）。用户买的是「省事、能改」，不是「AI」。

## 方向 A：方法 + 练完复盘（「有人替你排好，练完告诉你下次怎么调」）

**对谁**：办了卡、不知道练什么的新手（MESSAGE_HOUSE 细分 A、C）。
**证据**：r/beginnerfitness 天天有人问「怎么排计划」「没计划就坚持不了」（`docs/product/beginner-dropoff-top10.md`，在 #41 里）；Hevy 好评「I can simply arrive and begin at the gym… The routine is already set」（11-10 信号包）。

| # | 标题 | 副标题 | 靠的功能 |
|---|---|---|---|
| A1 | **Know what to lift today. Open it and start.** | Pick a split once. Every session after that is planned set by set — and if you miss a day, it waits for you. | `methods` `today-plan` `set-guidance`；「错过一天会等你」= 训练日按完成进度轮转，不按日历 |
| A2 | **A plan for people without a coach.** | Your split, today's exercises and the target for every set. After you train, a short note on what went well and what to focus on next time. | `today-plan` `set-guidance` `reviews` |
| A3 | **Stop making it up at the gym.** | Pawside runs a proven split for you, one set at a time. Missed Wednesday? Pick up on Friday. No red marks. | `methods` `set-logging` `weekly-progress`（休息日不算失败） |

**注意**：A3 的 "proven" 偏强，MESSAGE_HOUSE 要求不署名训练方法作者、只写「基于公开的训练思路整理」；上线前改成 "a well-known split" 更稳。

## 方向 B：说一句就记好（「一句话记饮食和训练，你确认了才保存」）

**对谁**：嫌记录麻烦、记几天就放弃的人（细分 D，以及所有怕记录的新手）。
**证据**：#27（拍照识别不稳被骂、语音记录被夸）；#40（记完改不动：份量只能按份、快速记录后只能删了重记，MacroFactor 用户 11-07、11-10 两次提到）；11-10 信号包 MyFitnessPal「The updated newest version is a pain… Constantly having to change screens to log」。

| # | 标题 | 副标题 | 靠的功能 |
|---|---|---|---|
| B1 | **Say what you ate. It's logged.** | Type one sentence — "chicken rice, half the rice" — and get a card to check. Nothing is saved until you confirm. | `xiaozhua-chat` |
| B2 | **Logging that takes one line, not five screens.** | Meals, workouts and your weight, in a sentence. You see the card first, fix anything, then save. | `xiaozhua-chat`；「fix anything」= 卡片上的「编辑」，以及说「米饭只吃了一半」改量 |
| B3 | **Track food without the spreadsheet feeling.** | Write it like a text message. Pawside drafts the entry and estimates calories and protein; you approve it. | `xiaozhua-chat` `meal-logging` |

**注意**：
- B1 例句「half the rice」：#41 刚修好「整份饭里的米饭没法单独改」时的说明，实际行为是提示用户改成「黄焖鸡饭吃了一半」，不是单独改米饭。上线前要么换例句（"a bowl of beef noodles"），要么等真能单独改。**推荐换例句。**
- 小爪现在能听懂夹英文的话（评测里有「ran 5k this morning」这题），但**回复只用中文**（`lib/coach-chat/prompt.ts` 第 105 行）。要让英文用户用方向 B，得先改回复语言（改提示词，要升版本、跑评测），并核对食物库对英文说法的覆盖，属于第 2 周以后的工作。现在不能写。
- MESSAGE_HOUSE 第 9 节红线「能聊天」写于小爪上线前，已过时；B 系列都只说「记录」，不说「聊天」「问它问题」，两种理解下都安全。

## 我的推荐（周五放进待批，工作日不问）

- **英文首页主句用 A，B 作第二屏。** 理由：A 靠的功能今天就能给英文用户用（换成英文字符串即可），B 依赖小爪支持英文输入，这是还没开始的工作。
- 但 **B 的差异化更强**：竞品都在把记录做成 AI 或拍照，用户抱怨的恰恰是「多了几步」「改不了」。等小爪英文跑通，B 可以升为主句。
- 建议的验证方式（不花钱、不发布）：周五一起列两个方向的英文落地页草稿，等英文界面上线后再做 A/B。

## 不写的话（对照 MESSAGE_HOUSE 第 9 节）

- 不写 "AI coach"、"chat with your coach"、"personal trainer in your pocket"。
- 不写 photo / scan / voice logging（拍照是 `planned`，语音没有）。
- 不写减重、增肌结果，不写用户数和评分。
- 不写 Oura 或任何设备。
