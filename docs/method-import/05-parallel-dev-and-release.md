# 方法论导入大更新 · 文档 5：并行开发与发布计划

- 状态：草案 v0.1
- 日期：2026-10-03
- 前置：文档 0–4。本文落实决策 D-5（三条车道并行）、D-9（Patch B 先行）与硬约束 H1–H10。
- 配套文件
  - `sql/05-draft-migrations.sql`：灰度开关（草案，不是迁移）
  - `tools/local-replay.sh`：本地回放工具（无 Docker、无 Supabase CLI 时可用）

## 0. 关卡记录（G1–G4）

**G1 检索**：读取了 `.github/workflows/quality.yml`、`scripts/validate-backend-package.mjs`、`PAWSIDE_BACKEND_RUNBOOK.md`、`supabase/cutover/README.md`、`netlify.toml`，以及 `claude/*` 分支与 PR 的状态（GitHub）。

**G2 审核**

| 类别 | 内容 |
|---|---|
| 已核实（读到代码） | CI 有两个任务：`app`（`npm test`、`tsc --noEmit`、`lint`、`build`）和 `database`（`supabase db start` 从迁移重建、`supabase db lint --local --level warning`、逐个运行 `supabase/tests/*.sql`，每个都必须成功）；预检脚本 `backend:preflight` 里硬编码了全部迁移与合约文件名清单；运行手册要求：不得对线上执行 `db reset`，失败后"向前修复"而不是销毁重置；`supabase/cutover/` 是"需要与线上代码协调才能执行的变更"的存放处，不被 `db push` 扫描；master 上没有功能开关的约定 |
| 已实测（本地） | 回放工具对 master 的 27 个迁移和 01–05 号草案按序执行通过；**仓库自带的 17 个 SQL 合约中 16 个通过，纯 master 与叠加全部草案后结果完全一致，唯一失败的是同一个 `profile_target_runtime_contract.sql`**（见第 9 节）；灰度开关的默认关闭、白名单、全员开关均符合预期 |
| 推断 | 合并到 master 会触发 Netlify 部署（`netlify.toml` 只有构建配置，触发条件未见） |
| 未核实 | CI 中 `supabase db lint` 对草案函数是否有告警（本沙箱没有 Supabase CLI，无法运行）；`profile_target_runtime_contract.sql` 在 CI 里是否通过；codex、deepseek 分支的状态 |

**G3 影响面**：见第 10 节。
**G4 冲突**：见第 8 节（Patch B 与在途分支）。

## 1. 目标

1. 三条车道并行开发，互不踩文件、互不踩迁移顺序。
2. 每一步都能单独回退：先关开关，再向前修复；DB 回滚只用于没有产生数据的新结构。
3. 全程不碰真实用户数据（H1）；每次迁移前后事实表哈希必须一致。

## 2. 车道与文件归属

| 车道 | 内容 | 拥有的路径 |
|---|---|---|
| **A 运行时** | 多日方法、私有方法的运行时、个人调整层、数据脱钩 | `supabase/migrations/*`（方法与训练相关）、`app/api/training/**`、`app/api/method/**`、`app/training/**`、`lib/method-catalog.ts`、`lib/method-availability.ts`、`lib/training-*.ts`、`lib/contracts/method/runtime-defaults.ts` |
| **B 导入** | 粘贴导入、抽取、金标、审核页、发布 | `lib/method-import/**`、`app/api/method-import/**`、导入与方法库相关页面、`scripts/method-import/**`（seed-library、eval）、`docs/method-import/gold/**` |
| **C 其他新功能** | 复盘中心（日/周/月）、复盘设置，以及你之后的新功能 | `components/BottomNav.tsx`、`app/weekly/**`、`app/history/**`、`app/settings/**`、`app/api/review/**`、`app/api/ai/**`、`lib/evidence/**`、`lib/nutrition/**` |

**共享文件（改动前先在 PR 里声明，并由先合并者让出）**

| 文件 | 谁会碰 | 约定 |
|---|---|---|
| `app/home/page.tsx` | A（改 `next_split_key` 类型，1 行）、C（复盘卡片） | A 只改类型行；C 在 A 之后变基 |
| `app/onboarding/page.tsx`、`app/api/onboarding/route.ts` | A（类型与文案） | 只由 A 改 |
| `lib/contracts/method/*` | A、B | 全部由"契约 PR"先行落地，之后只做增量 |
| `lib/ai-client.ts` | B | 不改现有导出；新增参数只增不改 |
| `supabase/migrations/*` | A、B、C | 按第 3 节的全局序列，不得自行取号 |
| `scripts/validate-backend-package.mjs` | 所有新增迁移/合约的 PR | 每个新迁移、新合约都要登记进清单 |
| `package.json` | B（脚本）、A | 只加脚本行 |

## 3. 迁移：全局序列

**原则**：本次所有迁移都是**增量或放宽**（新增表/列/函数/视图，放宽约束，替换为更宽松的触发器函数），没有任何收紧。因此它们对"正在运行的旧版本代码"向后兼容，**先上数据库、再上代码**，不需要放进 `supabase/cutover/`。若将来出现收紧型变更（例如重新加唯一约束），才走 `cutover/` 并参照其 README 的执行顺序。

**序列**（文件名为建议，时间戳取合并当天，只保持相对顺序；取号前先用文档 1 的核对 SQL V14 看线上已执行的最新版本，新号必须大于它）：

| 序 | 迁移（建议名） | 草案块 | 性质 | 依赖 |
|---|---|---|---|---|
| 1 | `feature_gating` | 05 | 新增 2 表、1 函数 | 无 |
| 2 | `guard_enrollment_delete` | 01 M5 | 新增触发器 | 无 |
| 3 | `exercise_identity_governance` | 01 M1 | 新增列、表、函数；读取策略改为"已审核或本人草稿" | 无 |
| 4 | `set_record_shape` | 01 M3 | 新增列，放宽 1 个约束 | 无 |
| 5 | `workout_session_soft_delete` | 01 M4 | 新增列 | 无 |
| 6 | `exercise_history_views` | 01 M2 | 新增 2 个视图 | 3、4、5 |
| 7 | `split_key_generalization` | 02 M6 | 放宽 5 个约束 | 无 |
| 8 | `split_day_types` | 02 M7 | 新增列，放宽状态约束 | 无 |
| 9 | `prescription_duration_targets` | 02 M8 | 新增列 | 4 |
| 10 | `source_authority_v2` | 02 M9 | 放宽 2 个约束 | 无 |
| 11 | `program_day_functions` | 02 M10 | 新增 2 个内部函数 | 7、8 |
| 12 | `private_method_visibility` | 02 M11 | 新增列、函数；替换 6 个读取策略 | 无 |
| 13 | `user_method_adjustments` | 02 M12 | 新增表 | 7 |
| 14 | `cascade_friendly_release_protection` | 02 M13 | 替换 2 个触发器函数（放宽） | 12 |
| 15 | `gold_exercise_library_tables` | 03 M14 | 新增列、3 表 | 3 |
| 16 | `user_method_imports` | 03 M15 | 新增表、触发器 | 无 |
| 17 | `resolve_or_create_exercise` | 03 M16 | 新增函数 | 3 |
| 18 | `source_document_user_text` | 03 M17 | 放宽 1 个约束 | 无 |
| 19 | `review_settings` | 04 | 新增 2 表 | 无 |

之后才是需要新写的函数：完成训练 v3、程序日 v2、保存逐组 v2、`enroll_in_method_release_v1`、`create_private_method_v1`、调整与跳过函数。它们的第一行都调用 `feature_enabled`（第 6 节）。

**每个迁移 PR 必须同时**
1. 把迁移文件登记进 `scripts/validate-backend-package.mjs` 的清单；
2. 新增对应的 rollback-only 合约到 `supabase/tests/`（文档 6 提供）；
3. 在本地运行回放工具并附上结果；
4. 在 PR 描述里写：迁移文件名、"向后兼容：是"、文档 1 的 V13 哈希前后对比（分支库）。

**替换策略时必须在同一事务内先删后建**（草案已满足，每一块都用显式 `begin … commit` 包住），避免出现"没有任何策略"的空窗。Supabase CLI 是否把一个迁移文件整体作为一个事务执行，本文未核实，所以不依赖它。

## 4. 契约 PR（第一个落地）

**内容**（只增不改，没有界面变化）
1. `lib/contracts/method/manifest.ts`：文档 2 的 zod schema，附单元测试（用文档 2 的肩部日示例）。
2. 分化键格式的常量与校验函数（`^[a-z][a-z0-9_]{1,31}$`），前后端共用。
3. 迁移序列中的 1–19（视批次可拆成数个 PR，但必须保持顺序），以及对应的 `supabase/tests` 合约。
4. `scripts/validate-backend-package.mjs` 的清单更新。

**验收**
- CI 的 `app` 与 `database` 两个任务全绿。
- 文档 1 的 V13 在分支库上前后一致。
- 现有全部测试不改动、全部通过。

**为什么先合它**：A、B、C 三条车道都依赖这些结构（B 依赖动作身份与导入表，A 依赖分化键放宽与日类型，C 依赖复盘表与开关）。它们彼此独立、都是增量，所以先合并不会改变任何现有行为。

## 5. 分支与 PR 规则

- **前置**：Patch B 全部合并（D-9）。在此之前车道 A、C 不开工，车道 B 可以先做不碰现有文件的部分（抽取、解析、校验、评测、金标种子）。
- **命名**：`claude/mi-<车道>-<序号>-<简述>`，例如 `claude/mi-a-01-split-key-generalization`。
- **叠放**：同一车道内一个任务一个 PR，叠在上一个之上；跨车道依赖在 PR 描述里写 `Depends on #N`，被依赖的先合并。
- **PR 描述固定包含**：做了什么、涉及哪份文档、是否含迁移（文件名）、是否向后兼容、数据安全证据（V13 或"无 DB 改动"）、回退方式（关开关 / 向前修复 / DB 回滚且无数据）。
- **PR 目标分支**：默认 `master`。不得指向他人的在途分支。
- **提交内容**：每个 PR 只含一个车道的文件；共享文件的改动单独成一个小 PR。

## 6. 灰度与开关

**为什么放在数据库**：登录用户对 `security definer` 函数有执行权限，只在接口层判断的话，用户可以绕过接口直接调函数。开关因此由 `feature_enabled(key)` 在函数内部强制。

**开关键**：`multi_day_runtime`、`method_import`、`adjustments`、`review_hub`。

**规则**
- 每个新的 `security definer` 函数第一行：`if not public.feature_enabled('<key>') then raise exception 'Feature not enabled' using errcode = '42501'; end if;`
- 开关表只由你在 SQL 编辑器写入（客户端无写权限，已实测写入被拒绝）；用户只能读到自己的白名单行。
- 前端通过一个只读接口 `GET /api/features` 取"我已开启的功能"，据此显示入口；入口不显示不等于安全，安全由函数内部保证。
- 开关不是用环境变量，因为环境变量无法限制到某个用户，也无法在数据库函数里读取。

**运维**（草案末尾已附 SQL）：给某用户开启、全员开启、紧急关闭，都是一条 SQL。

## 7. 发布阶段

| 阶段 | 内容 | 谁能看到 | 进入下一阶段的门槛 |
|---|---|---|---|
| 0 | 文档合并；Patch B 合并 | 无变化 | Patch B 全部合并、线上迁移与仓库一致（V14） |
| 1 | 契约 PR：迁移 1–19 先上线上，再合并代码 | 无变化（没有任何入口） | V13 哈希一致；V1 行数除新增表外一致；CI 全绿；Supabase 安全与性能建议无新增告警；账号删除合约通过 |
| 2 | 运行时切换：API 路由改调新函数，仅白名单用户（`multi_day_runtime`） | 你的测试账户与你 | 1.2 的全部既有测试通过；白名单账户走完"开始 → 记组 → 完成 → 下一天 → 整轮"；日志类型对 1.2 仍为 推/拉/腿 |
| 3 | 金标种子 + 导入（`method_import`、`adjustments`） | 白名单（你、测试账户、核心用户） | 评测 M1–M4 达标；真实调用下每步小于超时；至少 3 份真实文章端到端导入成功 |
| 4 | 复盘中心（`review_hub`） | 白名单 | 三种状态（普通日、周初、月初）用测试账户验证 |
| 5 | 全员开启（`enabled_for_all`） | 所有人 | 前几个阶段的数据指标稳定一周以上（指标见文档 4 第 2.5 节） |

**部署顺序（来自仓库既有教训）**：数据库先于代码。`supabase/cutover/README.md` 记录了反向的风险：新代码假设的约束与线上不一致会造成窗口期故障。本次所有变更向后兼容，所以先应用迁移、验证、再合并代码，永远不反过来。

**回退**
- 功能层面：关开关（一条 SQL），立即生效，不需要部署。
- 数据库层面：**优先向前修复**（运行手册的既定做法）。每个草案块末尾有手工回滚语句，只用于"新结构里还没有任何数据"的情况；一旦有用户数据写入新结构，不回滚，改为关开关并向前修复。
- 数据层面：新功能产生的数据（私有方法、导入记录、调整、复盘设置）都是增量，旧代码会忽略它们，不会受影响。

## 8. 与 Patch B 及在途分支的协调

**状态（GitHub 核实）**：PR #1–#11 全部 open，未合并；#12（测试账户脚本）基于 master，open。T 链（#1、#2→#3→#4、#5）以 `coach-ai-patch-2026-09-27` 为基；B 链（#6→#7→…→#11）以 `claude/coach-patch-b-spec` 为基。规格分支另有 B8–B10 尚未实现。

**要求**
- 本更新的任何迁移，必须基于 Patch B 合并后的最新 `complete_method_session_v2` 定义，否则会丢掉 B5 的时长逻辑（文档 0 附录 C）。
- `ai_generations`（T3）合并后，才能把 `method_import` 加入其 `surface` 约束。
- 复盘中心与训练卡会改 Patch B 已改过的页面（B3、B4、B9、B10），因此在其合并后才开工。

**未核实的在途分支**：`codex/internal-beta-runtime-truth`（领先 master 4 个提交）、`codex/p0-1-runtime-reliability`（领先 1 个）。它们是否已通过其他方式并入、是否仍在开发，需要你确认；若仍在改运行时，必须与车道 A 约定谁先合并。

## 9. 本地回放工具与已得到的证据

**工具**：`docs/method-import/tools/local-replay.sh`。参数：`--with-drafts`（叠加 01–05 草案）、`--contracts`（运行 `supabase/tests/*.sql`，逐个运行、失败不中断、最后汇总）、`--keep`（保留数据库）。要求 PostgreSQL 16 二进制，不能以 root 运行。桩环境模拟了 `auth.users`、`auth.uid()`、角色，并按 Supabase 的习惯设置了默认权限（不模拟默认权限时，权限类结论会与线上不同；这一点是在核对时发现的，并因此收紧了草案里 3 个函数的权限）。

**证据（2026-10-03）**

| 项目 | 结果 |
|---|---|
| master 的 27 个迁移从空库回放 | 通过 |
| 叠加 01–05 号草案 | 全部通过；`public` 表由 48 增至 58（正好 10 张新表） |
| 仓库自带 SQL 合约（17 个） | **纯 master：16 个通过、1 个失败；叠加全部草案：16 个通过、同一个失败。草案没有破坏任何现有合约** |
| 失败的那个 | `profile_target_runtime_contract.sql`，断言"body metric did not refresh target provenance"。纯 master 上同样失败，原因在桩环境里未能确定。已排除一种猜测：被测函数的生效日期是作为参数传入的（`save_body_metric_with_target_v1` 的 `p_target_effective_date`），所以不是简单的"依赖今天的日期"。可能是桩环境差异，也可能是该合约在 CI 里的前提未满足，**未核实 CI 中是否通过**；如果它在 CI 里也是红的，后续所有 PR 的 `database` 任务都会失败，需要先处理 |

**局限**：没有 Supabase CLI，无法运行 CI 的 `supabase db lint`；桩环境没有 Supabase 的存储、实时、扩展；数据量只有少量种子，验证的是结构与行为，不代表线上耗时。

## 10. 停线标准

任一条出现，立即停止合并与开关扩大，先排查：
1. 文档 1 的 V13 事实表哈希前后不一致，或 V1 行数出现减少。
2. 1.2 的既有测试或 SQL 合约出现新增失败。
3. 私有方法对非所有者可见（可见性合约失败）。
4. 账号删除合约失败。
5. 直接删除激活的 release 或官方 1.2 成功了。
6. 导入评测的硬门槛（M1–M4）不达标。
7. Supabase 的安全建议出现新增告警（例如新表未启用行级安全）。

## 11. 数量上限汇总

| 项目 | 上限 | 位置 |
|---|---|---|
| 导入次数 | 每用户 24 小时 5 条 | 数据库触发器（草案 03） |
| 粘贴原文 | 30000 字 | 导入表检查约束 |
| 私有方法数量 | 每用户 10 个 | `create_private_method_v1` 内检查（文档 2） |
| 草稿动作 | 每用户 100 个 | `resolve_or_create_exercise`（草案 03） |
| 每个方法的天数 | 14 天 | manifest 与校验（文档 2、3） |
| 每天动作数 | 12 个 | 校验规则 R4 |
| 每天总组数 | 40 组 | 校验规则 R4 |

## 12. 对影响面台账的补充（并入文档 0 附录 A）

| 模块 | 新增影响 |
|---|---|
| `scripts/validate-backend-package.mjs` | 每个新迁移与合约都要登记 |
| CI | `database` 任务会自动重放新迁移并运行所有 `supabase/tests/*.sql`，新合约必须是 rollback-only 且能通过 |
| 部署 | 数据库先于代码；合并到 master 可能触发部署（未核实触发条件） |
| 所有新函数 | 第一行校验开关；内部辅助函数必须显式撤销 `authenticated` 的执行权限（Supabase 默认授予） |

## 13. 待决事项

| 编号 | 问题 | 本文默认 |
|---|---|---|
| O-23 | Netlify 的部署触发方式 | 未核实；默认视为合并 master 即部署 |
| O-24 | `profile_target_runtime_contract.sql` 在 CI 中是否通过 | 需你查看 CI 记录 |
| O-25 | 谁来执行线上迁移 | 你，按运行手册的 `supabase db push`（先 `--dry-run`） |
| O-26 | 初始白名单名单 | 你本人、三个测试账户、核心用户 |
| O-27 | codex 分支是否仍在开发 | 需你确认 |

## 14. 本文的验收标准

- 契约 PR 合并后，CI 全绿，V13 哈希一致，且没有任何现有行为变化。
- 三条车道各自的第一个 PR 都能独立通过 CI，并且没有触碰其他车道的文件。
- 白名单外的账户调用任何新函数都得到"功能未开启"，已有自动化测试覆盖。
- 紧急关闭一个开关后，对应入口与函数立即失效，数据不丢失。
