# 自动迭代系统

Pawside 的学习引擎：工作日安静执行已批准的计划；周六晚出周计划（复盘 + 下周任务 + 待批事项），xxa 周日早上用 30–60 分钟批完。

目标（2026-11-07 定）：6 个月内 1000 个注册用户或 DAU 100；同时验证有人愿意付钱；出海和英文本地化已决定要做。

## 组成

| 部分 | 在哪 | 什么时候跑 | 做什么 |
|---|---|---|---|
| 信号采集 | `tools/signals/` + `.github/workflows/signals-daily.yml` | 每天北京 20:00 | 抓 Reddit、App Store 竞品评论、行业新闻，清洗后写到 `signals-data` 分支。不调用 AI，不需要密钥 |
| 例程 | Claude 定时任务，指令是 [DAILY_ROUTINE.md](DAILY_ROUTINE.md) | 每天北京 20:30 | 工作日：读信号、做计划里的任务、在周计划 issue 下追加进展；周六：出周计划；周日：按批复锁定计划 |
| 周复盘 | 合并在周六的周计划 issue 里 | 周六晚出，周日早上批 | 人打分；结论记进 [RETRO_LOG.md](RETRO_LOG.md) |

## 人和系统的边界

- 系统可以自己做：读公开数据、写分析、开 issue、开 PR（放在开关后面，默认关）、起草对外内容。
- 只能由人决定：合并 PR 和上线、对外发布任何内容、定价和对外承诺、新增 AI 用途。决定人是 xxa（xxa 在线时）；Sylvan 只读 issue。
- 所有仓库已有规则照旧适用（`CLAUDE.md`、`docs/coach/HANDOFF.md`）。

## GitHub 标签

`weekly-plan`（周计划）、`backlog`（待办）、`P0` `P1` `P2` `P3`、`待评估`、`signal`（来自外部信号的待办）。例程第一次运行时会补建缺少的标签。

## 改这套系统

改采集的版块和关键词：只改 `tools/signals/config/sources.yml`。改例程、分诊规则、分析方法：改本目录的文档，走 PR，xxa 确认后生效。
