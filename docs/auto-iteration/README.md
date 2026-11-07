# 自动迭代系统

Pawside 的每日学习引擎：找线索 → 研发 / 产品 / 用增各推进一点 → 把要人拍板的事写进 issue。人每天只做最多 5 个决定，每周六上午复盘打分一次。

目标（2026-11-07 定）：6 个月内 1000 个注册用户或 DAU 100；同时验证有人愿意付钱；出海和英文本地化已决定要做。

## 组成

| 部分 | 在哪 | 什么时候跑 | 做什么 |
|---|---|---|---|
| 信号采集 | `tools/signals/` + `.github/workflows/signals-daily.yml` | 每天北京 20:00 | 抓 Reddit、App Store 竞品评论、行业新闻，清洗后写到 `signals-data` 分支。不调用 AI，不需要密钥 |
| 每日例程 | Claude 定时任务，指令是 [DAILY_ROUTINE.md](DAILY_ROUTINE.md) | 每天北京 20:30 | 读信号和待办，按 [SIGNAL_METHOD.md](SIGNAL_METHOD.md) 分析，按 [TRIAGE_RULES.md](TRIAGE_RULES.md) 排优先级，推进三个视角，开当日 issue |
| 周复盘 | 周五晚的每日例程顺带生成，流程见 [WEEKLY_RETRO.md](WEEKLY_RETRO.md) | 每周六上午 | 出周报 issue，人打分；结论记进 [RETRO_LOG.md](RETRO_LOG.md)，下一轮据此调整 |

## 人和系统的边界

- 系统可以自己做：读公开数据、写分析、开 issue、开 PR（放在开关后面，默认关）、起草对外内容。
- 只能由人决定：合并 PR 和上线、对外发布任何内容、定价和对外承诺、新增 AI 用途。决定人是 xxa（xxa 在线时）；Sylvan 只读 issue。
- 所有仓库已有规则照旧适用（`CLAUDE.md`、`docs/coach/HANDOFF.md`）。

## GitHub 标签

`daily-iteration`（当日 issue）、`weekly-retro`（周报）、`backlog`（待办）、`P0` `P1` `P2` `P3`、`待评估`、`signal`（来自外部信号的待办）。例程第一次运行时会补建缺少的标签。

## 改这套系统

改采集的版块和关键词：只改 `tools/signals/config/sources.yml`。改例程、分诊规则、分析方法：改本目录的文档，走 PR，xxa 确认后生效。
