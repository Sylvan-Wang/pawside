# 小爪 Patch v1.0 对照评估（需求 × 现有代码）

日期：2026-10-22。基线：分支 `claude/admiring-tesla-w1am2j`，HEAD `500ad2e`（本评估之前）。
方法：逐条拿 Patch 的断言去对照仓库代码和迁移，并在本地 Postgres 16 上把全部迁移跑了一遍。
没验证过的写「未验证」，不把推测写成事实。

## 0. 本地验证环境（这轮评估的证据来源）

| 项 | 结果 |
|---|---|
| `npm ci` + `npx tsc --noEmit` | 通过，无报错 |
| `npx vitest run`（改动前） | 60 个文件、462 个用例全部通过 |
| 本地 Postgres 16 + 最小 Supabase 仿真（`auth.users`、`auth.uid()`、`anon/authenticated/service_role`） | 40 个迁移按顺序全部应用成功 |
| `supabase/tests/*.sql`（23 个契约） | 改动前 23/23 通过 |
| OpenAI 密钥 / 能否连 `api.openai.com` | **都没有**。所以所有「真实模型」的验证本轮做不了，见第 4 节 |
| Netlify / 线上 Supabase | 看不到。线上库迁移是否完整：**未验证** |

仿真库不是 Supabase 本体：没有 Storage、Realtime、PostgREST，RLS 靠 `set role authenticated` 加 JWT claim 模拟。结论只对「SQL 逻辑」成立。

## 1. Patch 的断言 × 代码：有没有真冲突

结论先说：**Patch 的主体设计与现有架构没有冲突**，可以纯增量做。核对出 5 处需要处理的实际问题，其中 3 处 Patch 没有预见到（标 ★）。

### 1.1 一致、可直接复用（已用代码确认）

| Patch 的说法 | 代码事实 | 判断 |
|---|---|---|
| `callStructuredOutput` 无需先做原生 tool calling | `lib/ai-client.ts:151` 一次 `/responses` 调用，`json_schema` + `strict:true` | 一致。用「单次结构化计划 + 服务端白名单执行」 |
| layout 无共享宿主，各页自引 `BottomNav` | `app/layout.tsx` 只有 `<body>{children}</body>` | 一致。在根布局挂宿主，按路由显隐 |
| 受保护页由 `proxy.ts` 跳转登录；API 自己鉴权 | `proxy.ts`：`!pathname.startsWith('/api')` 才跳转；各路由自己 `getUser()` | 一致。新路由必须自己鉴权 |
| 规范饮食写入幂等、带版本检查 | `save_food_log_canonical_v1`（`client_request_id` 唯一索引 + 咨询锁）、`replace_food_log_canonical_v1`（`p_expected_updated_at`，冲突抛 `40001`） | 一致 |
| 未知≠0 | `daily_nutrition_summary` 有 `*_data_status`，条目营养列可空，`sumConsumed` 有未知项就返回 null | 一致，且数据库层已经支持 |
| 旧反馈不能因为已知总量低就判全天不足 | `meal-feedback.ts`：`consumed===null` → `insufficient_data`；`data_completeness!=='complete'` 时 below 会降级 | **不需要改**，已满足 |
| `ai_generations` 预留 `coach_chat` | 迁移 `20260926000700`：`surface` 含 `coach_chat`，`invoked_by` 含 `orchestrator`，有 `trace_id/turn_index` | 一致 |
| 功能开关可按用户 | `app_features` / `user_features` / `feature_enabled()` | 一致。新增一行 `coach_chat` |
| 新用户表要进导出/删除 | `tests/account/user-data-coverage.test.ts` 会拦住漏登记 | 一致 |
| 设备数据不进 AI | `tests/devices/no-ai.test.ts` 扫描固定目录 | 一致。要把新目录加进扫描清单（只加不减） |

### 1.2 真实问题（需要在实现里处理）

1. **★ 体重同日写入会清空其他字段。** `save_body_metric_with_target_v1` 对 `(user_id,date)` 冲突执行 `do update set weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct, waist_cm=excluded.waist_cm, ...`（全部列）。聊天只说「体重 70」若直接调用，会把当天已记的腰围、体脂、备注覆盖成空。
   处理：聊天的体重服务先读当天已有行，把未提供的字段原样带上，再调同一个 RPC；卡片上写明「会更新今天已有的体重」。不改现有 RPC。
2. **★ 粗记录被旧 RPC 的校验挡住。** `save_food_log_canonical_v1` / `replace_…_v1` 要求每个条目 `weight_g > 0`（否则 `invalid food item`）；`user_food_logs.input_mode` 在 RPC 里写死 `'manual'`；`deriveItemForPersistence` 对没有参考数据且未确认的条目直接抛错。
   处理：新增 `save_food_log_canonical_v2` / `replace_food_log_canonical_v2`（旧版一字不动，旧客户端零影响）：允许「无克数且四项营养全为空」的粗记录条目，`input_mode` 由参数传入；服务层加 `nutrition_unknown` 条目。库表本身（`weight_g`、营养列均可空）不需要改。
3. **★ 两个旧页面对「无克数」条目有隐患。**
   - `app/history/[date]/page.tsx:255` 渲染 `{item.weight_g ?? item.weight}g`，无克数时会显示成「宫保鸡丁 g」。
   - `app/food/[id]/edit/page.tsx` 保存时 `foods.filter(f => f.name && f.weight)`：对一餐里的粗记录条目，**保存时会悄悄丢掉它**。
   处理：这两处各做最小修复（历史页无克数不显示克、标「营养待补」；编辑页对「有名称、无克数、无营养」的条目带 `nutrition_unknown` 提交，PATCH 路由改走 v2）。
4. **自由运动没有幂等，也没有热量字段。** `POST /api/workout` 无 `request_id`；页面 `app/workout/page.tsx:71` 直接用浏览器客户端 `insert`，绕过 API；`workout_logs` 无热量列。
   处理：迁移加 `client_request_id`（部分唯一索引）、`calories_burned_kcal`（可空）、`input_source`，新增 `save_workout_log_v1` RPC；`POST /api/workout` 接受可选 `request_id` 并走它。**页面直写本轮不动**（见决策日志 D-07：改动面大、与本 Patch 验收无关，已列入待答问题）。
5. **`ai_generations.fail_reason` 是封闭枚举。** 聊天的失败原因必须落在现有枚举内（映射到 `invalid_response` / `upstream_error` / `timeout` 等），否则插入会被约束拒绝，而 `logGeneration` 又会吞掉错误，表现为「日志悄悄没写」。处理：不改约束，做映射并加测试。
6. 另：`logGeneration` 的 `payload` 是 `NOT NULL` 且会整体保存。聊天只传结构化字段（任务类型、工具名、状态、数量），不传用户原文（Patch §9 要求）。

### 1.3 Patch 内部/与旧文档的小矛盾（已按「新需求优先」处理）

- 旧 Spec 称「小黑猫」，市场文档与 Patch 都落在奶牛猫 → 用现有 `CatMascot`（奶牛猫）。
- 旧 Spec 的气泡只覆盖三类触发；Patch 增加食谱触发。本轮不做气泡（依赖食谱），写入待答问题。
- Patch §0 说「不得削减照片和食谱」，同时允许分阶段、真实来源阻塞时不能硬通过。本轮的处理方式见第 3 节：不假装完成。

## 2. Patch 里「由开发查明」的未决问题：答案

| 问题 | 答案 | 证据 |
|---|---|---|
| 当前迁移是否完整 | 仓库内完整：40 个迁移在干净库全部应用。**线上库状态未验证** | 本地复现 |
| 体重同日写入语义 | 整行覆盖（见 1.2-1） | `20260926000500_profile_target_runtime.sql` |
| 规范/旧记录 ID | `PATCH/DELETE /api/nutrition/food-log/[id]` 的 `[id]` 是**旧 `food_logs.id`**；GET 再换成 `canonical_food_log_id`。聊天只存规范 `user_food_logs.id` | `app/api/nutrition/food-log/[id]/route.ts` |
| `ai_generations` 约束 | 见 1.2-5 | 迁移 `20260926000700` |
| 模型是否支持图片/转写 | **未验证**（无密钥、无网络）。默认模型名 `gpt-5.6-luna` 的能力我无法确认 | — |
| 部署超时与上传限制 | **未验证**。`netlify.toml` 没有设置超时；平台默认值要在 Netlify 后台查 | `netlify.toml` |

## 3. 可行性分级与本轮范围

### A. 本轮实现并验证（有代码 + 测试 + 本地真库）

| Patch 范围 | 做法 | 验证方式 |
|---|---|---|
| 入口与面板（B01） | 根布局挂 `CoachHost`，按路由显隐；开关关闭则完全不渲染 | 单元测试（显隐规则）；**真机/浏览器未测** |
| 会话与草稿、状态机、幂等、版本 | 新表 + 触发器 + RLS | 本地 PG 契约测试 |
| 日期与时区（F21） | 服务端解析相对日期，凌晨晚饭触发一次澄清 | 单元测试 |
| 文字记饮食（草稿 → 确认 → 写入）、粗记录、对话纠正、已保存餐修改 | 复用 `saveFoodLog/replaceFoodLog`，新增 v2 | 单元 + 本地 PG |
| 实际运动补记（B03）、体重（B05）、当天情况（B04） | 见第 1.2 节 | 单元 + 本地 PG |
| 一次追问预算（F31）、改口/取消（B06）、多任务独立回执 | 编排器 | 单元测试（脚本化的模拟模型） |
| 越权（F29）、恶意指令（F32） | 写操作只能由确认接口提交；确认接口只提交服务端保存的草稿内容 | 单元 + SQL |
| 导出/删除（B11）、设备隔离（B12） | 登记 `USER_DATA_TABLES`；扫描清单加新目录 | 既有测试 |
| 官网同步 | `companion` 保持「规划中」（开关未对外，不能写成内测中） | `tests/site` |

### B. 只能做准备，不能宣布完成

| 项 | 为什么不能算完成 | 本轮做的准备 |
|---|---|---|
| 真实模型下的意图/食物识别质量 | 无密钥、无网络 | 提示词 + 严格 schema + `npm run coach:eval` 评测脚本（早上在有密钥的环境一条命令跑完），固定语料 |
| 性能 p50/p95、超时 | 看不到部署环境 | 编排器限制调用次数与总耗时，并记录分项耗时；真实数值待测 |
| 键盘/安全区/录音（B02） | 需要真机 | 用 `visualViewport` 与 `dvh` 实现；**待真机验收** |

### C. 本轮不实现（附原因与前置条件）

| 项 | 原因 | 解锁条件 |
|---|---|---|
| 照片识别（F01–F06、F30） | ① 私有 Storage 桶与策略是线上基础设施，仿真库没有 Storage，无法验证；② 视觉模型能力未验证；③ 隐私文案与实际行为需同步发布；④ Patch 要求 30 例标注集，我们没有 | 你确认 Storage 桶创建方式、给出带密钥的验证环境和标注样本 |
| 产品内语音 | 需要真机麦克风 + 转写接口验证；音频保留策略需你确认 | 同上 |
| 食谱来源与推荐 | **没有指定 UP 主链接**；Patch 明确不得用虚构链接通过 | 提供真实来源链接 |
| 偏好记忆、站内气泡 | 依赖食谱/偏好表设计；与核心闭环无关 | 你回答待答问题 Q4 |
| 空间估算试验 | Patch 本身标注为不阻塞的试验支线 | — |

Patch 的原话是「不得由困难程度擅自削减」。所以 C 类不是删除，而是**明确的待办 + 阻塞原因**，写进决策日志和待答问题；发布闸门（Patch §12）因此**不成立**，不能对外说「整版完成」。

## 4. 验收口径说明

Patch §11 的 F01–F32、B01–B12 初始状态都是「未执行」。本轮结果在 `docs/coach/XIAOZHUA_TEST_REPORT.md` 逐条记录：**通过 / 失败 / 阻塞 / 未执行**，并写清环境和证据。mock 或脚本化模型的用例只证明「服务端逻辑正确」，不证明「真实模型识别正确」，报告里分开标。
