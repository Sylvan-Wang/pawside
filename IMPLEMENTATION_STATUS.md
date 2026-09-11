# Pawside 2.0 Method 实施状态

> 更新日期：2026-09-11
> 工作分支：`feature/method-guidance-v1`  
> 范围：仅 Pawside；不涉及 Morrow。  
> 发布边界：Method v1.2 已按 `internal_beta / v1_runtime` 激活；基础训练周期 Runtime 已推送 Supabase。Strict Method 与自适应策略仍未激活。

## 发布门结论

| 发布门 | 当前状态 | 依据 |
|---|---|---|
| V1 Runtime Release | `ACTIVE / INTERNAL BETA` | Q-001、Q-004 使用有来源标记的产品执行默认；Runtime Gate 通过 |
| Strict Method Certification | `HOLD` | Day 3 部分精确组次、Cable Curl 正式 reps/progression 仍缺可重放的原始/官方直接 Source |
| Phase 2 Enrollment Foundation | `ACTIVE` | 能力画像、release pin、Cycle 1 初始化与首个 Push Prescription 已通过生产链路验证 |
| Production Activation | `BASE CYCLE RUNTIME ACTIVE / ADAPTIVE HOLD` | Prescription、Actual、Push/Pull/Legs 推进及下一周期已连通；长期 Progression/Recovery/Adaptive Coaching 仍不在当前 GO 范围 |

## 任务清单

| # | 任务 | 状态 | 完成定义 |
|---:|---|---|---|
| 1 | 核验 P0 Resolution Patch | `DONE` | 未把产品默认伪装为 method truth；双发布门明确 |
| 2 | 更新 Canonical Workbook | `DONE` | v1.2 副本写入 Day 3/Curl 字段级 authority、calibration-only、Q 状态 |
| 3 | Source / Release / Evidence 数据层 | `DB APPLIED` | 6 个 Phase 1 migrations、RLS、active uniqueness、immutability、policy 分层和 v1.2 validated draft 已在目标 Supabase replay |
| 4 | Canonical Importer | `LOCAL PACKAGE DONE` | v1.2 checksum、19 sheets、manifest/diff、import run、3 splits、15 prescriptions、field provenance 与双门禁草稿 migration 已完成 |
| 5 | P0 Runtime Defaults | `DONE` | Day 3/Curl typed prescription + field provenance；calibration 不创建 progression |
| 6 | Contract / Unit Tests | `TS PASS / SQL SCHEMA APPLIED` | 双发布门、provenance、草稿不激活及 enrollment 安全测试 18/18 通过；migration 已 replay，SQL contract 仍需独立执行 |
| 7 | 本地回归 | `PASS / DB HOLD` | typecheck、lint、test、build、media preflight 通过；Supabase CLI/Docker/psql 缺失 |
| 8 | Method UI/UX Patch 审计与页面投影 | `PREVIEW DONE` | 原入口原位增加预览；新增三日计划与动作详情；未改底部导航和运动记录 UI |
| 9 | 全 App 视觉一致性检查 | `PARTIAL PASS` | 480px 总览/详情真实截图通过版式与配色检查；CDN 动作帧在无头截图中近似空白，需真实浏览器复核 |
| 10 | 远端 DB push | `DONE` | 2026-09-10 已推送 7 个 Method/Enrollment migrations 至 `sbwevlhzqujrtucppacl`，远端历史复核一致 |
| 11 | Internal/Beta Activation | `WAITING FOR LATER PHASES` | 至少完成 Enrollment、Prescription、Actual 与安全验收 |
| 12 | Phase 2 能力画像与 Enrollment | `DB APPLIED / NOT ACTIVE` | Onboarding 能力画像、active release guard、release pin、Cycle 1/Push 原子初始化、重试 API 均已实现并 replay；release 未激活 |
| 13 | Phase 2 移动端视觉回归 | `PASS` | 480px 真机比例渲染通过；未改变底部导航和运动记录 UI |
| 14 | Netlify production 部署 | `LIVE / API VERIFIED` | Deploy `6aa365a6ef7ff830dedae360` 已上线 `https://paw-side.com`；Auth、Proxy、未登录边界与已登录完整周期 API 均通过 |
| 15 | Method Workout Runtime | `DB APPLIED / BUILD PASS` | start、逐组 Actual、complete、计划内历史镜像和所有权边界已实现 |
| 16 | 完整三分化周期 | `PRODUCTION DB E2E PASS` | Push → Pull → Legs → Cycle 2 Push 已以临时账号实际执行；重复开始/完成幂等，临时账号已清理 |

## 明确不做

- 不修改或拆分 Morrow。
- 不改变 Pawside 底部导航、Home IA 或现有“运动记录”入口和 UI/UX。
- 不让 Next.js 页面或 Route Handler 在运行时读取 xlsx。
- 不把 `product_execution_default` 改写成“作者明确规定”。
- 不把 `v1_runtime` 激活表述成 Strict Method 认证。
- 不把俯卧撑次数换算成卧推重量；能力题只收窄后续校准范围。
- 不在缺少 active release、完整能力画像或完整健身房器械时伪造 Method enrollment。
- 不自动执行 `npm audit fix --force`；依赖风险单独审计。

## 2026-09-10 本轮证据

- Workbook v1.2 SHA-256：`52e762d6867d672e9dffd9f6c890aef8235f4b6280dd0eb6902909cf53baf3cd`。
- Importer：`valid=true`、Runtime Gate=`passed`、Strict Gate=`blocked`。
- Method unit/contract tests：5 files / 18 tests 全部通过。
- Next.js 16.3.4 production build：通过；`/training/method` 与 `/training/method/[exerciseKey]` 已注册。
- npm audit：0 vulnerabilities（Vitest 已从 4.1.1 升至 4.1.11）。
- Workout Guide：15 个动作身份；13 个映射均可解析，其中 7 个 confirmed、6 个 candidate；2 个无准确素材并保持 unmapped。
- v1.2 数据库草稿：`validated/internal_beta`、Runtime Gate=`passed`、Strict Gate=`blocked`；migration 不创建 enrollment、不写 active。
- 视觉：总览与动作详情的移动端层级、留白和黑白灰配色通过；素材帧仍保留单独复核项。
- Phase 2：新增 capability profile、enrollment release pin、Cycle 1/Push 原子初始化、显式重试 API 与 Onboarding UI；只有 active + Runtime Gate passed 的 release 才可能加入。
- Phase 2 安全降级：非完整健身房返回 `EQUIPMENT_REVIEW_REQUIRED`；无 active release 返回 `METHOD_NOT_READY`；基础设置仍可保存。
- Phase 2 视觉：480×3400 本地移动端整页实渲染通过，无溢出、截断或虚假启用提示。
- Supabase replay：目标项目 `sbwevlhzqujrtucppacl` 为 `ACTIVE_HEALTHY`；13 个本地 migration 与远端历史完全一致。
- Netlify：production deploy `6aa2c9bba263680cb036fadc` 已上线；登录页 CSS 与 8 个 JS 资源全部 200，`/auth`=200，未登录 Method=307 → `/auth`，`/api/ai/status`=401 `UNAUTHORIZED`。
- 静态资源修复：manual deploy 的发布根目录由错误的 `.next` 改为 Netlify adapter 产出的 `.netlify/static`，并显式携带已构建 Functions；线上移动端截图确认样式恢复。
- Netlify Windows CLI：使用 Next 16 官方 `--webpack` production build，并仅在本地 Windows 打包时标准化 Next Runtime 虚拟模块路径；Linux 云构建不应用该补丁。

## 2026-09-11 Workout Runtime 证据

- 新增 normalized `workout_sessions / exercise_executions / set_executions`；Prescription 与 Actual 分开保存。
- `start_method_session / save_method_set_actual / complete_method_session` 仅通过 authenticated RPC 写入；Actual 表启用并强制 own-user RLS，浏览器角色没有直接写权限。
- 完成计划内 Push 后生成 Pull；完成 Pull 后生成 Legs；完成 Legs 后结算当前 cycle、将 enrollment 递增至下一轮并生成新 Push。
- 完成 Method Session 会向兼容 `workout_logs` 写一条带唯一关联 ID 的历史记录；额外自由训练仍不推进 Method split。
- 生产 Supabase migration `20260911000200_method_workout_runtime.sql` 已应用；远端 schema lint 无错误。
- 生产数据库真实 E2E：`push → pull → legs → push`、Cycle 1 completed、Cycle 2 in_progress、3 条历史关联、重复 start/complete 幂等均通过；临时账号及级联数据已清理。
- Netlify production deploy `6aa365a6ef7ff830dedae360` 已上线；通过真实登录 cookie 调用生产 Onboarding、Today、Start、Session、Set、Complete、Progress 接口完成整轮，最终状态为 Cycle 2 / Push ready。
- 全量测试 7 files / 29 tests、TypeScript、ESLint、Netlify production build 均通过。
- Windows 浏览器自动化进程因本机 ACL 沙箱连续终止；生产 UI 路由已编译，视觉点击链路留给真机/人工 smoke，不将其虚报为已通过。
- 当前仍未宣称完成：长期动作阶段 Progression、历史修改后的下游重算、Recovery/Discomfort 与 Adaptive Coaching policy activation。
