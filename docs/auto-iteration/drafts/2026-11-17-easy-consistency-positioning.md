# 首页主句重写：「让坚持变容易」（草稿，中英文各 4 版）

> 2026-11-17，xxa 否掉了 11-10 草稿的方向 A「Know what to lift today」和方向 B「Say what you ate」。
> xxa 的判断：看了几个健身产品，评论区说得最多的是「坚持才是最难的」。所以 Pawside 的核心说法应该是**坚持容易、低摩擦**，整个产品也往这个方向走，而不是自娱自乐地加功能。
> 本文只是草稿，不改官网。xxa 选定后，再开 PR 改 `app/welcome/page.tsx` 的 hero 和 `metadata`。
> 写之前读过 `docs/marketing/MESSAGE_HOUSE.md`；每版后面写明靠的是 `lib/site/features.ts` 里哪条已上线功能，以及在代码里核对过的事实。

## 为什么旧的 A、B 不对

A 和 B 说的都是**一个功能**（排好的计划、一句话记录）。用户买的不是功能，是「这次我能坚持下去」。功能只是证据，应该放在副标题里，不该当主句。

新主句只说一件事：**坚持这件事，在 Pawside 里更省力。** 副标题用 2–3 个今天就成立的事实证明它。

## 能用来证明「省力」的事实（已在代码里核对）

| 事实 | 依据 | 能不能对外说 |
|---|---|---|
| 打开就是下一次要练的内容，不用自己排 | `methods` `today-plan` | ✅ |
| 按完成进度轮转，不按日历；没练的那天还在，不用补 | `today-plan`；MESSAGE_HOUSE 支柱 4 | ✅ |
| App 里没有连续打卡天数（11-17 搜过 `app/` `components/` `lib/`，没有「连续」「streak」） | 代码 | ✅ 可以说「没有打卡天数」，但**不能用「断签」这个词**（`tests/site` 的旧规则还拦着它，见下文「顺带发现」） |
| 选今天有多少时间：30 / 45 / 60 / 90 分钟，动作数量跟着调 | `lib/training-duration.ts` | ✅ 最短 30 分钟，不能写 15 分钟或「几分钟」 |
| 每组目标写在旁边，做完一组记一下 | `set-guidance` `set-logging` | ✅ 但**不能说「点一下就行」**：重量会预填目标值，次数是空的，要自己填（`app/training/sessions/[sessionId]/page.tsx` 第 339 行） |
| 一句话记饮食、运动、体重，先出卡片，确认了才保存 | `xiaozhua-chat` | 中文 ✅；英文 ❌（小爪只回中文） |
| 本周目标自己定，休息日不算失败 | `weekly-progress` | ✅ |

## 英文主句（4 版）

前提不变：App 现在只有中文界面，英文句子只能用在英文界面上线后的官网，或写明 "English version in progress" 的候补页。英文版不能提一句话记录。

| # | 标题 | 副标题 | 靠的功能 |
|---|---|---|---|
| E1 | **Make sticking with it the easy part.** | Open the app and your next workout is ready, sized to the time you have. Skip a week and it picks up where you left off. Nothing to make up, no streak to protect. | `today-plan` `methods` 时长选择；无打卡天数 |
| E2 | **The hard part is showing up. We made it lighter.** | No plan to write, no weights to remember, no streak to keep alive. Pick 30 minutes or 90 and start. | `today-plan` `set-guidance` 时长选择 |
| E3 | **Less to decide. Less to log. Easier to keep going.** | Today's workout is already planned and every set shows its target. Missed a few days? You continue from the next session, not from day one. | `today-plan` `set-guidance` `set-logging` |
| E4 | **Built for the week you almost quit.** | Busy, tired, behind? Open it, pick how long you have, and do the next session. Pawside never counts what you missed. | 时长选择、按进度轮转、`weekly-progress` |

注意：
- E2 的 "no weights to remember" 现在只对了一半：重量预填的是**本次目标**，不是「你上次做了多少」。#68 的「上次：40 kg × 8, 8, 7」做完才完全成立。上线前要么等 #68 第一步，要么删掉这半句。
- E4 情绪最强，但 "almost quit" 带一点负面，适合放广告或社区帖，不一定适合首页。

## 中文主句（4 版，现在的官网就能用）

现在的 hero 是「今天练什么？打开就知道。」，说的也是一个功能。

| # | 标题 | 副标题 | 靠的功能 |
|---|---|---|---|
| Z1 | **坚持，不用那么费劲。** | 打开就是下一次训练，从上次停下的地方接着练。今天只有 30 分钟，就按 30 分钟排。吃了什么说一句，确认了才记下。 | `today-plan` 时长选择 `xiaozhua-chat` |
| Z2 | **最难的是坚持。我们把每一步都变轻了。** | 不用自己排计划，不用记上次练到哪，没有打卡天数要守。空了一周回来，接着练下一次，不用补。 | `methods` `today-plan`；无打卡天数 |
| Z3 | **少想一点，少记一点，更容易练下去。** | 今天练什么已经排好，每组目标写在旁边；饮食说一句就能记。没练的日子不算失败。 | `today-plan` `set-guidance` `xiaozhua-chat` `weekly-progress` |
| Z4 | **忙的时候，也能接着练。** | 选今天有多少时间，动作跟着调；断了几天，打开还是下一次该练的内容。 | 时长选择、按进度轮转 |

注意：
- Z1 和 Z3 用了小爪的一句话记录，英文版没有对应能力，所以英文对应句里没写。
- 「没有打卡天数」可以说；`tests/site` 拦的是「断签」这个词，Z 系列都没用。
- 都不说 AI、不说教练、不承诺结果。

## 推荐

**英文用 E1，中文用 Z1。**

- 两句的结构一样：主句说「坚持变省力」，副标题给三个今天就成立的证据（打开就有、按时间缩、断了接着来）。这是 xxa 说的「坚持容易、低摩擦」最直接的翻译，又不空。
- E1 不依赖小爪英文，也不依赖 #68，英文界面上线当天就成立。
- Z1 的「不用那么费劲」是用户自己的口吻，不是口号；它也和 MESSAGE_HOUSE 0.5 节的核心句一致（「它负责让你下一次打开时，知道该从哪里继续」）。
- 第二屏建议：现在的「没练，也不会掉队」那一段（按轮次走，不按日历）往上提到第二屏，它就是这个定位最强的证据。

如果 xxa 选定，下一步是一个小 PR：改 `app/welcome/page.tsx` 的 hero、`TITLE`、`DESCRIPTION`，跑 `npx vitest run tests/site`；英文句子先存进 #67 的英文字典，开关默认关。

## 顺带发现（不在本 PR 改）

- `tests/site/site-copy.test.ts` 拦「断签」的理由是「首页有连续打卡」，MESSAGE_HOUSE 第 6、9 节也这么写。但 App 里已经搜不到连续打卡了。规则过时了：要不要放开「断签」这个词，等 xxa 决定（改测试属于改对外红线）。
- MESSAGE_HOUSE 的「屋顶」还是「不懂也能练对，不完美也能练下去」。新定位选定后，屋顶和四根支柱的顺序要跟着改（「坚持容易」升为屋顶，四根支柱变成它的证据）。这是改对外基调，先问 xxa。
