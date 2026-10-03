# 方法论导入大更新 · 最终复扫报告

- 日期：2026-10-03
- 依据：文档 0 第 7 节的流程——全部文档完成后，用附录 B 的同一批命令全量复扫，与附录 A 的影响面台账逐项比对，差异写入本报告。
- 扫描对象：`origin/master @ eb9ab2a`、Patch B 链头 `origin/claude/coach-b6-output-v1-checklist @ 9483963`、规格分支 `origin/claude/coach-patch-b-spec @ dc4e19c`，以及全部远程分支（月复盘检索）。
- 外部状态：12 个 PR（#1–#12）全部 open，没有合并；master 自本轮开始未变化。

## 1. 结论

台账整体成立，复扫发现 **4 处遗漏**，已全部补入对应文档；没有发现会推翻既有设计的新问题。其余扫描项与台账一致。

## 2. 扫描项与结果

| 编号 | 扫描内容 | 结果 | 与台账比对 |
|---|---|---|---|
| A | 所有远程分支中的"月复盘 / monthly / 月度 / 按月"（ts、tsx、sql） | 没有任何命中 | 一致：月复盘与复盘总设置不存在，属新设计（O-1） |
| B | 读取训练与方法相关表的位置（`from('…')`，范围 `app`、`lib`） | master 25 个（文件、表）组合；Patch B 头 33 个，新增 8 个，没有减少 | **有遗漏**，见第 3 节 |
| C | RPC 调用方 | master 与 Patch B 头完全一致，14 个函数名 | 一致：与方法相关的 8 个中，开始训练 v3、更新时长、设置动作状态不含分化键写死，其余由文档 2 第 5.2 节的新函数覆盖 |
| D | 代码里写死 `'push'`、`'pull'`、`'legs'` 的非测试文件 | master 与 Patch B 头完全相同的 8 个文件 | 一致：8 个都在文档 2 第 8 节的改动清单里 |
| E | SQL 里写死分化键的迁移 | 9 个迁移文件；只有最新定义需要替换，早期定义已被覆盖 | 一致：约束 5 处、完成训练函数、程序日函数、报名函数均已列入 |
| F | 测试里写死分化键的文件 | 3 个：`tests/method-import/enrollment-migration.test.ts`、`tests/method-runtime/minimum-p1-runtime.test.ts`、`tests/method-runtime/workout-runtime.test.ts` | 一致：这些测试保持不动（我们不改旧迁移），新方法用新夹具 |
| G | `components/`、`netlify/`、`scripts/`、`proxy.ts` 是否读取这些表 | 没有 | 一致：扫描范围覆盖完整 |
| I | `.from(`、`.rpc(` 后面不是字符串字面量的写法（防止变量拼出表名或函数名而漏扫） | 没有命中 | 一致：字面量检索可以代表实际读取面 |
| H | PR 与分支状态 | #1–#11 open、未合并，#12 open；规格分支比 B1 分支多 B8–B10 附录 | 一致（文档 0 附录 C-2） |

## 3. 复扫发现的遗漏及处理

| 编号 | 发现 | 位置 | 处理 |
|---|---|---|---|
| R1 | `/api/method/current/progress` 读取 `method_cycles` 的 `push_session_id / pull_session_id / legs_session_id` 三列，新方法这三列为空。目前没有界面调用它，只有 `tests/api/normal-state-http.test.ts` 对该文件文本做断言（要求保留 `kind: 'not_enrolled'`） | `app/api/method/current/progress/route.ts:32` | 已补入文档 2 第 8 节、文档 7 的 A4：改为按处方状态汇总，保留原返回字段，扩展而不是删改测试断言 |
| R2 | `SPLIT_LABELS` 只有 push/pull/legs 三项，且未知键回落为**原始键**。新方法会把 `chest` 这类英文内部值带进教练文案和日复盘证据 | `lib/coach/display.ts:43`；使用处 `lib/coach/workout-context.ts:149,300`、`lib/evidence/daily-review.ts:19`（均为 Patch B 链） | 已补入文档 0 附录 A（风险 A4）、文档 2 第 8 节、文档 5（车道 A 增加 `lib/coach/**` 的相关读取）、文档 6 第 6 节、文档 7 的 A7 |
| R3 | Patch B 之后，日复盘证据不再只读 `workout_logs`：`lib/evidence/daily-review.ts:13-19` 读取 `method_enrollments.next_split_key`。台账原来写的是"日复盘不读方法表"，那只对 master 成立 | `lib/evidence/daily-review.ts` | 已更正文档 0 附录 A 的日复盘一行；该文件在文档 5 中标为共享文件（A 改名称对照一处，其余归 C） |
| R4 | Patch B 新增 `app/api/workout/session-feedback/route.ts`，读取 `workout_sessions`、`set_executions`；软删除过滤清单原来没有它 | `app/api/workout/session-feedback/route.ts` | 已补入文档 1 第 6 节的清单与文档 0 附录 A |

## 4. 本轮验证过程中发现并已修入的问题（汇总）

| 编号 | 问题 | 发现方式 | 处理 |
|---|---|---|---|
| V1 | 删除一个报名会把该报名下的全部训练记录一并删除 | 本地回放实测 | 草案 M5：对有历史的报名加删除前触发器，账号删除不受影响 |
| V2 | 激活后的 release 不允许再写入内容 | 本地实测 | 创建私有方法的顺序写成硬约束：先 `validated` 写内容，最后激活 |
| V3 | 保护触发器会拦住账号删除（私有方法随用户级联时） | 本地实测 | 草案 M13：只放行"所属方法已被删除"的级联；直接删除仍被阻止 |
| V4 | `method_splits.key`、`method_source_chunks.split_key` 也有 push/pull/legs 检查约束，会直接阻止新分化日入库 | 查约束定义 | 草案 M6 放宽共 5 处 |
| V5 | 内部辅助函数对登录用户可执行（Supabase 默认授予） | 把本地桩环境改得更贴近 Supabase 后暴露 | 4 个函数显式撤销 `authenticated` |
| V6 | 配额触发器先于行级安全执行，会泄露他人的配额状态 | 合约测试 | 触发器只对本人写入计数 |
| V7 | 客户端可以把自己的导入标成"已发布" | 合约变异检验 | 收紧插入与更新策略 |
| V8 | 给 `set_executions(user_id)` 加索引反而让视图查询变慢 | 25 万行合成数据实测 | 结论：不加；"取上次"用专用查询（约 8 ms） |
| V9 | 数量解析原型一度把"动作之间休息"当成"组间休息"，我自己写的预期值也错了 | 复核时发现 | 已更正，作为必须保留的测试用例 |
| V10 | Patch B 规格分支有 B8–B10 我此前没做；B9 的"上次"按 split 而不是按动作，与脱钩原则不一致 | 读规格分支与代码 | 记入文档 0 附录 C-2 与 README 的待决事项 |

## 5. 扫描的局限

- 扫描基于文本检索，用变量拼出来的表名或 RPC 名（如 `.from(tableName)`）会漏掉。为此补跑了一次检索（`.from(`、`.rpc(` 后面不是字符串字面量的写法，范围 `app`、`lib`、`components`，master 与 Patch B 头）：没有命中。仍不能排除用别的方式间接拼出名称。
- 只扫描了 `app`、`lib`、`components`、`netlify`、`scripts`、`proxy.ts` 与 `tests`；运行时配置、数据库里的函数互相调用没有用文本检索覆盖，那部分由 SQL 合约和回放实测承担。
- Patch B 合并后的最终形态可能与现在的链头不同；它们合并后需要把本报告的 B、C、D、F 项再扫一遍（命令见文档 0 附录 B）。
- 在途分支 `codex/*` 的内容没有逐个检查（文档 5 第 8 节、待决事项 O-27）。

## 6. 本轮本地验证的最终证据

环境：PostgreSQL 16，master 的 27 个迁移从空库回放，叠加 `sql/01`–`05` 草案；回放工具 `tools/local-replay.sh --hash-check --contracts --draft-tests`。

| 项目 | 结果 |
|---|---|
| master 的 27 个迁移 | 通过 |
| 叠加草案 01–05 | 全部通过；`public` 表 48 → 58（正好 10 张新表） |
| 事实表哈希（写入训练历史后，应用草案前后） | 逐表一致 |
| 哈希检查的有效性 | 草案里故意改写逐组数据、故意删除日志，两种违规都被报警 |
| 仓库自带的 17 个 SQL 合约 | 16 个通过，1 个失败（`profile_target_runtime_contract.sql`）；**纯 master 与叠加全部草案结果完全一致**，草案没有破坏任何现有合约 |
| 4 份草案合约（106 条断言） | 全部通过；14 次变异检验全部被抓到 |
| 数量解析原型 | 对 22 条真实写法 22/22 通过 |
| 动作库覆盖 | 36 个文章动作都能在 302 条库里找到候选；其中多个有歧义，需标候选 |
| 视图规模实测 | 重度用户（约 1 万组、全库 32 万组）约 90 ms，专用查询约 8 ms，普通用户约 5 ms |

**没有验证、不能声称的**：线上数据；Supabase 的存储、实时等平台行为；CI 的 `supabase db lint`；`profile_target_runtime_contract` 失败的根因；OpenAI 严格 schema 在抽取 schema 上的实际耗时与 token 用量；web search 工具可用性；Netlify 的函数超时。
