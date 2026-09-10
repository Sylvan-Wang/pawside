# Pawside 2.0｜Method Implementation Map

> 状态：Phase 2 schema 已推送至 Supabase；Method release 保持未激活  
> 分支：`feature/method-guidance-v1`  
> 约束：不合并 main、不发布 production、不激活 Method、不做 destructive migration，直到用户逐 Phase 确认。

## 1. 推荐架构

继续使用当前 Next.js + Supabase 的**模块化单体**，不拆微服务：

```text
Offline Editorial / Admin Plane
  Original Source
  → Source importer / chunker
  → Canonical Workbook reader
  → Validator
  → Diff
  → Draft Method Release
  → Tests
  → Explicit Activation

Online Runtime Plane
  Active immutable Method Release
  + Enrollment-pinned Release
  + User Runtime State
  + Prescription / Actual
  + Deterministic Engines
  → Structured Decisions
  → Template / OpenAI Explanation
```

边界原则：

- `txt/xlsx` 只能进入离线 importer，不能被 Route Handler 或训练页面运行时读取。
- RAG 只找证据与解释，不决定训练处方。
- Method rule、product adaptation policy、user fact、engine decision、AI wording 分层存储。
- Guidance 优先作为 `method_rules.config_json` 的类型化子结构，并通过 exercise/split/rule key 关联；不为每一条文案新建独立表。
- Active release 不原地修改；新 Workbook 产生新 release。
- 用户 Enrollment 固定 `method_release_id`，不随新版本静默漂移。
- 所有不完整证据保持 nullable/inactive；用户端按范围降级，而不是 AI 补齐。

## 2. 全阶段路线图

| Phase | 目标 | 核心产物 | 激活影响 |
|---|---|---|---|
| 0 | Current audit | 本文件 + `CURRENT_METHOD_GAP.md` | 不激活 |
| 1 | Method Infrastructure | Source、Importer、Release、Canonical rules、Evidence | 只允许 draft/blocked release |
| 2 | Onboarding + Enrollment | 能力画像、release pin、cycle、next split | 仅在 active release 存在后开放 |
| 3 | Method Overview + Home | 用户看见当前方法、循环、下一训练日与原因 | UI 首次 Method-aware |
| 4 | Today Prescription | 确定性生成 Session/Exercise/Set Prescription | 仍不等于训练执行完成 |
| 5 | Workout Runtime + Guidance | Warm-up、动作指导、逐组 Actual、autosave、偏差入口 | 形成执行事实层 |
| 6 | Calibration + Progression | 重量校准与方法阶段分别运行、可审计事件 | 下一次 prescription 可变化 |
| 7 | Adaptive Coaching | deviation、discomfort、pause/resume、returning、recalibration | 接住现实偏差 |
| 8 | Method-aware Review / Progress | Home/History/Weekly/Review/Reward 消费 Method context | 完整长期闭环 |

用户已于 2026-09-09 确认开始实施，并于 2026-09-10 继续推进 Phase 2。本文继续约束逐 Phase 实施，不会自动跨入 Phase 3。

## 2.1 Phase 2 本地交付状态

Phase 2 已完成以下本地实现：

- `onboarding_capability_profiles` 保存轻量能力画像；俯卧撑答案只作为画像，不参与重量换算。
- `method_enrollments` 固定 `method_release_id` 与可选 policy release，并增加暂停元数据。
- `initialize_current_method_enrollment()` 在单事务内校验用户资料、能力画像、器械环境和 active Runtime release，再创建 Enrollment 与 Cycle 1；首个 split 固定为 Push。
- `complete_phase2_onboarding()` 原子保存基础资料与能力画像，并在满足发布门时尝试加入。
- `/api/method/enroll` 提供显式重试；`/api/method/current` 区分未开放与可加入但尚未加入。
- Onboarding 保留原基础资料并增加四个轻量能力问题；完整健身房以外的情况保存资料但返回器械审核提示。

Phase 2 外部状态：

- 7 个 Phase 1/2 增量 migration 已在 Supabase 项目 `sbwevlhzqujrtucppacl` replay，远端 migration history 与本地一致。
- SQL contract 尚未以独立测试事务执行；当前证据为 migration replay 成功与远端版本一致。
- v1.2 release 尚未 activation，因此线上不会创建 enrollment。
- Netlify production deploy `6aa2c1064b505d8a19fcbcb9` 已上线 `https://paw-side.com`，可测试 Auth、Onboarding 和未激活态降级。
- Phase 3 尚未启动。

## 3. Phase 1 目标

把 Canonical Workbook 从“人工审核附件”变成可验证、可追溯、可版本化、可审计的 Method 发布输入：

```text
Source metadata/checksum
→ source chunks
→ workbook validation
→ normalized canonical rows
→ validation report + diff
→ draft method release
→ evidence links
→ release tests
```

Phase 1 本地实现完成后能够准确说：

> “Workbook v1.2 已生成 validated internal-beta draft；Runtime Gate 通过，Strict Gate 因 Q-001/Q-004 保持阻塞；未激活、未创建用户 enrollment。”

不能说：

> “用户已经可以完整跑三分化。”

## 4. Phase 1 数据库变化

### 4.1 新表

#### `method_source_documents`

保存 L0 Source 的不可变身份，不保存机器本地绝对路径作为生产定位。

```text
id
method_id
source_key
source_type              transcript | official_video | prd | spec | workbook
title
version
checksum_sha256
source_uri               storage/git/url locator
status                   registered | ingested | superseded | missing
metadata_json
created_at
```

约束：`unique(method_id, source_key, version, checksum_sha256)`；新版本 insert，不覆盖旧 bytes identity。

#### `method_source_chunks`

保存证据切片；Runtime 训练决策不依赖它在线可用。

```text
id
source_document_id
method_id
chunk_key
ordinal
section_key
split_key
exercise_id
topic
content
source_locator_json
confidence
content_checksum_sha256
embedding                 nullable; model/dimension 未锁定前不建 ANN index
embedding_model           nullable
embedding_dimensions      nullable
created_at
```

约束：同一 source document 下 `chunk_key`、`ordinal` 唯一。Phase 1 必须提供 lexical lookup fallback。

#### `canonical_import_runs`

记录每次 importer 的输入和结果。

```text
id
method_id
workbook_version
workbook_checksum_sha256
importer_version
status                    validating | rejected | draft_created | validated | failed
validation_report_json
diff_json
row_counts_json
release_id                nullable
started_at / completed_at
created_by                nullable
```

同一 workbook checksum 可重复 dry-run，但创建 release 必须幂等。

#### `method_releases`

这是新的方法版本真值；`methods` 退回为稳定 Method identity。

```text
id
method_id
version
status                    draft | blocked | validated | active | retired | rejected
workbook_checksum_sha256
source_set_checksum_sha256
canonical_import_run_id
validation_report_json
release_notes
created_at
validated_at
activated_at
activated_by
```

约束：`unique(method_id, version)`；每个 Method 最多一个 active release；active 后禁止更新 Canonical content。

#### `method_rule_sources`

建立 `Method Rule → Evidence` 的可审计关系。

```text
id
method_rule_id
source_chunk_id
evidence_key              Workbook EvidenceID
relationship              explicit | derived | supporting | conflicting
confidence
review_status
reviewed_at / reviewed_by
created_at
```

方法真值若标记“发布必需”，必须能解析到实际 source chunk；产品策略可以引用 PRD/Spec source。

#### `adaptation_policy_releases`

产品 Coaching 策略与 Method release 分开版本化。

```text
id
version
status                    draft | blocked | validated | active | retired
workbook_checksum_sha256
validation_report_json
created_at / activated_at / activated_by
```

#### `adaptation_policies`

```text
id
policy_release_id
scenario_key
trigger_json
input_contract_json
safety_priority
decision_json
effects_json
copy_template_json
source_type               method | derived | product_policy | mixed
evidence_key              nullable
status
created_at
```

### 4.2 现有表的非破坏性改造

#### `methods`

- 保留现有行和列，避免破坏当前 API。
- 将 `key/name/description/source_metadata` 视为 identity。
- `version/status` 标记为 transitional legacy；新 Runtime authority 改为 `method_releases`。
- 不把现有 `1.0/draft` 原地改 active。

#### `method_splits`

- 新增 `method_release_id`。
- 为当前结构 seed 创建一个 `legacy-structural-1.0` draft release 并 backfill。
- backfill 校验通过后建立 `unique(method_release_id, key)` 和 `unique(method_release_id, order_index)`。
- 旧 `unique(method_id,key)` 需要在同一事务中替换，否则无法创建第二 release；先验证、再 drop constraint，不删数据。

#### `method_rules`

- 新增 `method_release_id`、`source_type`、`canonical_status`、`evidence_required`、`config_schema_version`。
- `rule_type` 扩展为：

```text
principle
prescription
technique
progression
calibration
recovery
warmup
regression
substitution
```

- 新唯一键：`unique(method_release_id, rule_key)`。
- `config_json` 继续承载不同 rule type 的结构化内容，但 importer 必须用 discriminated union 校验，不能放自由文本杂物。

#### `method_split_exercises`

- 继续以 release-scoped `method_split_id` 关联动作。
- 增加 nullable `technique_rule_key` / `purpose_rule_key`；复用现有 prescription/progression/regression/substitution/warmup keys。
- 对 evidence-incomplete 行允许 rule key 为 null 或引用 inactive rule；不得产生可执行 set prescription。

#### `exercises`

- 保留为跨 release 的 canonical exercise identity。
- Phase 1 从 Workbook 新增 Pull/Legs 动作身份，但只在 canonical name 有稳定结论时 upsert。
- aliases、target region、movement role 可以同步；处方与进阶不得塞入 `exercises`。

#### `exercise_media` / `exercise_external_mappings`

- 继续作为媒体层，不参与 Method truth。
- `candidate` 可展示“待动作审核”标签，但不能充当 rule evidence。
- 修改现有 media SQL contract：缺少 confirmed workout-guide mapping 不应阻塞 Method release；缺媒体时可降级为审核过的文字 Guidance。

### 4.3 Phase 1 不创建的用户运行时表

以下表在设计上需要，但应按用户给定阶段留到 Phase 2/5/6/7，避免 Phase 1 跨范围：

```text
Phase 2
  initial_capability_profiles
  user_training_state
  method_enrollments.method_release_id / policy_release_id / pause metadata

Phase 5
  workout_sessions
  exercise_executions
  set_executions

Phase 6
  progression_events
  calibration decisions/events（可并入 adaptation_decisions 的 typed scope）

Phase 7
  recovery_checkins
  recovery_decisions
  training_deviations
  training_discomfort_events
  adaptation_decisions
  user_coaching_signals
  domain_events
```

## 5. 拟新增 migrations

文件名在执行时如已有同 timestamp 文件则顺延；不覆盖现有 migration。

1. `supabase/migrations/20260909000100_method_source_schema.sql`
   - `method_source_documents`
   - `method_source_chunks`
   - checksum/identity constraints
   - reference-data read policy；server/admin only write

2. `supabase/migrations/20260909000200_method_release_governance.sql`
   - `canonical_import_runs`
   - `method_releases`
   - release-scoped backfill for `method_splits` / `method_rules`
   - rule type expansion
   - active release uniqueness与 immutable trigger

3. `supabase/migrations/20260909000300_method_evidence_and_policy.sql`
   - `method_rule_sources`
   - `adaptation_policy_releases`
   - `adaptation_policies`
   - product policy 与 method evidence 的约束

4. `supabase/migrations/20260909000400_method_release_security.sql`
   - RLS、grants、写权限收口
   - authenticated 只读 active reference rows
   - draft/import/evidence 写入只允许受控 importer/admin path
   - 不引入被前端读取的 service-role key

5. `supabase/tests/method_release_contract.sql`
   - 检查表、FK、唯一键、RLS、active uniqueness、immutability、enrollment future pin compatibility

6. `supabase/tests/method_import_contract.sql`
   - 检查 draft import 行数、blocker、EvidenceID 解析和 source checksum。

每个 migration 都使用显式事务或可失败回滚的 DDL 顺序；不 reset、不 truncate、不删除 legacy 日志。

## 6. Canonical Importer

### 6.1 运行位置

只允许在 CLI/受控管理流程运行：

```text
scripts/method-import/
  cli.mts
  workbook-reader.mts
  sheet-registry.ts
  canonical-validator.ts
  canonical-mapper.ts
  canonical-diff.ts
  source-ingestion.ts
  release-writer.ts
  activate-release.ts
  report-writer.ts
```

Next.js Route Handler 和训练页面不得 import `workbook-reader`。

### 6.2 执行步骤

1. 读取 Workbook bytes 并计算 SHA-256。
2. 校验 Workbook version、Method key、19-sheet registry 和 required headers。
3. 只读取导入契约允许的 sheets/状态。
4. 校验 stable IDs、重复 key、split 顺序、exercise mapping、rule references、stage graph。
5. 读取 `09` 和 `18` 形成 scope blocker；不导入成 Runtime rows。
6. 解析 `EvidenceID → method_source_chunk`；缺失必需 evidence 则 blocker。
7. 校验 `05` progression state graph 可达性；只允许明确声明的循环。
8. 校验 `12` 不把 Calibration 误写成 Progression。
9. 校验 `13` 每个生效场景都有 trigger、decision、write targets 和 source type。
10. 生成 validation report 与相对上一 release 的 semantic diff。
11. 在单事务内创建 `canonical_import_run + draft/blocked release + canonical rows`。
12. 跑 SQL contract、rule unit tests 和 Workbook fixtures。
13. 只有显式 `activate-release` 命令才允许激活；Workbook v1.2 可通过 V1 Runtime gate，但 Strict Method Certification 仍因两项 Source gap 保持 HOLD。

### 6.3 Importer 输出

```text
artifacts/method-import/<run-id>/
  validation-report.json
  validation-report.md
  canonical-diff.json
  canonical-diff.md
  row-counts.json
  release-manifest.json
```

这些是构建/审计产物，不是 Runtime 输入；数据库中的 checksum 和 run ID 是追溯主键。

## 7. Server services 与类型

### 7.1 Server-only domain services

```text
lib/server/method/
  source-repository.ts
  chunk-repository.ts
  release-repository.ts
  rule-repository.ts
  evidence-repository.ts
  adaptation-policy-repository.ts
  release-validator.ts
  release-diff.ts
  release-activation.ts
  method-context-builder.ts      # Phase 1 只定义接口，不接训练决策
```

所有模块显式标记 server-only。数据库写入只从受控 server/CLI 发生；浏览器不能写 reference Method 数据。

### 7.2 Shared contracts

```text
lib/contracts/method/
  source.ts
  release.ts
  rule.ts
  guidance.ts
  canonical-import.ts
  evidence.ts
  adaptation-policy.ts
  errors.ts
```

核心 union：

```text
MethodRuleConfig
  PrincipleRuleConfig
  PrescriptionRuleConfig
  TechniqueGuidanceConfig
  ProgressionRuleConfig
  CalibrationRuleConfig
  RecoveryRuleConfig
  WarmupRuleConfig
  RegressionRuleConfig
  SubstitutionRuleConfig
```

`TechniqueGuidanceConfig` 至少覆盖：purpose、setup、concentric、eccentric、breathing、ROM、cues、common problems、stop/regress、media dependency。缺项允许 null，并保留 `evidence_status`。

### 7.3 依赖提案

- `zod`：Importer 和 API/runtime contract validation。
- 一个只用于离线 importer 的 xlsx reader（优先评估 `exceljs`）；安装前核对当前官方版本、许可证和安全状态。
- `vitest`：TypeScript rule/import fixture tests；如果最终决定只用 Node 原生测试，则先解决 Node 20 下 TS 执行方案。
- pgvector：只在 embedding model/dimension 确认后启用索引。Phase 1 允许 chunks 没有 embedding，lexical evidence lookup 必须可用。

## 8. API 变化

### 8.1 Phase 1 推荐：不增加公开写 API

当前应用没有管理员角色/权限模型，也已移除未使用的 Supabase service-role 环境变量。为避免把 Method 发布面暴露到公网，Phase 1 采用本地/CI CLI 作为唯一写入口。

因此 Phase 1：

- 不新增用户可调用的 source/import/activate POST API。
- 不改变 `/api/method/current` 的 unavailable 行为。
- 不让浏览器直接读取 draft release。
- 可以在 server service 层先定义未来接口 contract，但不发布 route。

### 8.2 后续可选 Admin API（需单独批准管理员认证方案）

```text
POST /api/admin/method/sources
POST /api/admin/method/imports/validate
POST /api/admin/method/imports
GET  /api/admin/method/imports/:id
GET  /api/admin/method/releases/:id/diff
POST /api/admin/method/releases/:id/activate
```

### 8.3 后续用户只读 API

```text
GET /api/method/current                 # Phase 2：返回 enrollment-pinned release
GET /api/method/current/progress        # Phase 2/6
GET /api/method/overview                # Phase 3
GET /api/method/rules/:ruleKey/evidence # Phase 3 explanation
```

## 9. Repo 文件布局

### Phase 1 会新增

```text
docs/product/system/method/
  README.md
  source-registry.json
  canonical/
    Pawside_三分化_Canonical_Method_Workbook_v1.1.xlsx
  sources/
    README.md
    # 原始 transcript 收到后再放入；当前不创建伪文件

scripts/method-import/**
lib/contracts/method/**
lib/server/method/**
tests/method-import/**
tests/method-rules/**
artifacts/method-import/.gitkeep
supabase/migrations/20260909000100_*.sql
supabase/migrations/20260909000200_*.sql
supabase/migrations/20260909000300_*.sql
supabase/migrations/20260909000400_*.sql
supabase/tests/method_release_contract.sql
supabase/tests/method_import_contract.sql
IMPLEMENTATION_STATUS.md
```

### Phase 1 会修改

```text
package.json
package-lock.json
.gitignore
eslint.config.mjs             # 只加入 `.netlify` 等生成目录 ignore，使标准 lint gate 可复现
supabase/tests/pawside_backend_contract.sql
supabase/tests/workout_guide_media_contract.sql
supabase/README.md
PAWSIDE_BACKEND_RUNBOOK.md
```

### Phase 1 不修改

```text
app/home/page.tsx
app/onboarding/page.tsx
app/training/today/page.tsx
app/workout/**
app/food/**
app/body-metrics/**
app/history/**
app/weekly/**
app/settings/**
lib/ai-client.ts
```

这样可以保证 Phase 1 不伪装成用户体验已完成，也不碰已有 Journal 主流程。

## 10. Phase 1 输入状态

| 输入 | 状态 | Phase 1 行为 |
|---|---|---|
| Workbook v1.1 | 可用，checksum 已知 | 纳入 repo 后由 importer 再计算，不信任手填 hash |
| PRD / Spec / Patches | 可用 | 注册为 product/system sources，产品策略 evidence 可引用 |
| 原始 transcript | 缺失 | source status=`missing`；方法证据 link 不得伪造 |
| 官方视频 URL | Workbook 有 registry | 可注册 URL metadata；本 Phase 不自动抓视频/字幕 |
| Q-001 / Q-004 | unresolved/blocking | release=`blocked`；对应 canonical rows inactive/nullable |
| Warm-up | 部分完整 | 建立 rule shape，内容不完整的 split 标 `evidence_incomplete` |
| Coaching threshold | 1 条待确认 | policy inactive，事实仍可在后续保存 |

## 11. Phase 1 风险与控制

| 风险 | 后果 | 控制 |
|---|---|---|
| 把 Workbook 当 Runtime config | 发布不可审计、历史漂移 | 只允许 CLI importer；runtime package graph 中禁止 xlsx reader |
| 现有 method version 与新 release 冲突 | 多版本无法共存 | 先建 release/backfill，再替换 split uniqueness；全程不删数据 |
| 缺 transcript 仍生成 evidence | 伪造可追溯性 | source=`missing`、必需 evidence unresolved、阻止 validate/activate |
| JSON rules 无结构约束 | 运行时分支不可预测 | Zod discriminated union + schema version + import validation |
| 将产品策略伪装成原方法 | 用户解释失真 | 独立 policy release + source_type + evidence relation |
| Media 成为错误发布门 | 规则完整却因素材阻塞 | 媒体质量单独验收；文字 Guidance 可降级；candidate 明确标记 |
| RAG 服务故障 | 训练不可用 | Runtime 只读已发布规则；RAG 仅解释，提供 lexical fallback |
| Migration 破坏现有 journal | 用户已有功能受损 | additive-first、事务、无 reset/truncate、legacy 表不改 |
| 当前工作树已有大量未提交变更 | 审计归属混淆 | Phase 1 每次 diff 按文件分组，避免覆盖既有修改 |

## 12. Phase 1 验收 Happy Path

### 12.1 实际 Workbook v1.1（预期正确结果）

```text
运行 dry-run validator
→ 识别 19 个 sheets
→ 只选择 02/03/04/05/12/13/14 + 条件式 10
→ 09/18 只作为 gate
→ 生成准确 row counts
→ 识别 Q-001、Q-004 与 transcript missing
→ 生成 validation report + diff
→ 创建 blocked/draft release
→ 生效行可进入 release-scoped tables
→ 待补证据行保持 inactive/nullable
→ 当前 app 仍显示 Method 尚未开放
```

这不是失败；这是对当前权威数据最正确的 Phase 1 行为。

### 12.2 合成完整 fixture（验证发布机制，不代表正式 Method）

```text
复制最小测试 fixture
→ 所有 evidence 与 state transition 完整
→ validator PASS
→ 创建 validated test release
→ 未运行 activate 时仍不影响 active release
→ 显式 test activation 后只能有一个 active
→ 再次修改 active rows 被数据库拒绝
```

### 12.3 回归门

- TypeScript typecheck PASS。
- ESLint PASS。
- Next production build PASS。
- Existing backend/media contracts PASS（按新 media gate 更新预期）。
- 新 migration 从空库可顺序 replay。
- Import 同一 checksum 幂等。
- RAG/embedding 不可用时 validation 与已发布 Method Runtime 不受影响。
- 当前 Auth、Home、Workout、Food、Body、History、Weekly、Review 路由没有行为回归。

## 13. Phase 1 完成后仍不会有

- 新用户 Enrollment。
- Method Overview UI。
- Home Method active context。
- Today prescription generator。
- 可交互 Workout Runtime。
- 逐组 Actual。
- Weight Calibration engine。
- Progression engine。
- Recovery / Adaptive Coaching。
- Method-aware Review。

这些必须按 Phase 2–8 逐阶段评审。

## 14. 请求确认的 Phase 1 执行范围

建议批准的最小范围：

1. 新建 Source/Release/Evidence/Policy foundation migrations。
2. 添加 release-scoped backfill，不删除现有表或数据。
3. 建立离线 Workbook importer、validator、diff 和审计产物。
4. 将已提供的 Workbook 与四份产品/系统文档登记到 repo；原始 transcript 缺失保持显式状态。
5. 导入 v1.1 为 blocked/draft release；不 activate。
6. 添加 SQL、unit、fixture tests 和 `IMPLEMENTATION_STATUS.md`。
7. 不改 UI、不创建用户 enrollment、不推 production。

只有收到明确确认后才开始上述 Phase 1。
