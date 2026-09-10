# Pawside 2.0 Method 实施状态

> 更新日期：2026-09-10  
> 工作分支：`feature/method-guidance-v1`  
> 范围：仅 Pawside；不涉及 Morrow。  
> 发布边界：Phase 2 schema 已推送至 Supabase，代码已部署 Netlify production；Method release 保持未激活，当前用于未激活态测试。

## 发布门结论

| 发布门 | 当前状态 | 依据 |
|---|---|---|
| V1 Runtime Release | `READY FOR IMPLEMENTATION` | Q-001、Q-004 已有明确的字段级产品执行默认；不再阻塞 Runtime 开发 |
| Strict Method Certification | `HOLD` | Day 3 部分精确组次、Cable Curl 正式 reps/progression 仍缺可重放的原始/官方直接 Source |
| Phase 2 Enrollment Foundation | `DB APPLIED / NOT ACTIVE` | 能力画像、release pin、Cycle 1 初始化与 API/UI 已完成；7 个增量 migration 已在目标 Supabase replay |
| Production Activation | `HOLD` | 当前没有 active release；Prescription Engine、Actual 与适应性训练闭环尚未完成 |

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
| 14 | Netlify production 部署 | `LIVE / ASSETS VERIFIED` | Deploy `6aa2c9bba263680cb036fadc` 已上线 `https://paw-side.com`；CSS/JS、Auth、Proxy、API 未登录边界均通过 |

## 明确不做

- 不修改或拆分 Morrow。
- 不改变 Pawside 底部导航、Home IA 或现有“运动记录”入口和 UI/UX。
- 不让 Next.js 页面或 Route Handler 在运行时读取 xlsx。
- 不把 `product_execution_default` 改写成“作者明确规定”。
- 不因为 Workbook 可导入就把 Method 状态改为 active。
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
