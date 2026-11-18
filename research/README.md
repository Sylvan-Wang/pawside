# Pawside 每日研究

本目录位于 `signals-data` 分支。按北京时间查阅 [每日更新日志](LOG.md)，再打开当天简报。档案适用于产品研究、食谱选题和 SEO 草稿。

| 文件 | 用途 |
| --- | --- |
| `LOG.md` | 每天一行，含两板块状态、简报链接、DOI / PMID。用于检索与跨日去重 |
| `daily/YYYY-MM-DD.md` | 发表日期、设计、样本、主要结果、证据强度、局限、对 A/B 的直接性，以及最多三条独立的产品验证项 |

## Claude 开发 Agent 读取方式

从 GitHub 读取仓库 `Sylvan-Wang/pawside` 的 `signals-data:research/LOG.md`。本地可用 `git fetch origin signals-data`，再用 `git show FETCH_HEAD:research/LOG.md` 查看，无需切离开发分支。根据日志读取 `research/daily/<北京时间日期>.md`。无合格新增时读当天状态，需要回顾旧证据时顺着有研究收录的日期链接查阅。

- **训练方法**。先对照 `master:docs/coach/METHOD_RULES.md` 和 `master:docs/product/system/method/`。有采用价值时整理成待评审提案，包含适用人群、测试指标和停止条件。正式规则仍走 evidence registry、方法校验与 release 流程。
- **食谱**。区分论文直接测试的饮食方案与研究启发的原创食谱。可准备草稿与候选视频，按 `master:docs/coach/RECIPES_RUNBOOK.md` 核验来源、每份口径和发布状态。
- **SEO**。用原始来源支撑能安全转述的内容，保留人群、研究期限和不确定性。按 `master:docs/marketing/MESSAGE_HOUSE.md` 准备草稿，发布按仓库现有流程。

证据强度是本简报对具体结论的评估，并单独标注对 Pawside 人群的直接性。产品指标须实测。勘误、撤稿与正式发表版更新应链接原条目并明确说明变化，保留首次收录日期。
