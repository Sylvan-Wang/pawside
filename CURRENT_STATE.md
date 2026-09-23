# Pawside 2.0 Phase 0｜Current State Audit

> 审计日期：2026-09-04  
> 审计范围：`D:\Pawside` 当前工作区，只读代码审计；未修改业务代码、数据库或远端数据。  
> Git 基线：`master`，`da1894a6c40b63af18754282cf13acaeb526a487`（2026-04-17）。  
> 注意：工作区在审计前已存在用户改动/未跟踪文件，详见“审计边界”。

## 1. 审计证据与边界

### 1.1 实际读取的产品文档

| 文档 | 实际内部版本 | 行数 | SHA-256 |
|---|---:|---:|---|
| `C:\Users\Administrator\Downloads\Pawside_2.0_Overview_PRD_全模块产品PRD_v0.1 (2).md` | PRD v0.1 | 2,998 | `1496F370187F665C45B8F3588302079ECE0AA9FC7DB6C31E846C78A969FE733D` |
| `C:\Users\Administrator\Downloads\Pawside_2.0_System_Spec_v0.1 (1).md` | System Spec v0.1 | 3,646 | `954611E17097DD32E05CB5DDA053F5E3AA527B9EAA8134602425CB4066069003` |

用户已在 2026-09-04 明确确认：以上两份实际附件就是本轮 Source of Truth。虽然第二份文件的标题和内部版本均写 `System Spec v0.1`，本轮不再等待另一个 v0.2 文件；文档内显式 `[TBD]` 仍保持未决。

### 1.2 远端 Supabase 验证状态

- `.env.local` 只检测到 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY`；未输出其值。
- 当前 `.env.local` 已于 2026-09-04 23:35:06 更新到目标 project ref `sbwevlhzqujrtucppacl`；只检测 key 是否存在，未输出 key。
- 用户已确认：原同名/旧 Supabase 项目及其数据已删除，当前 `sbwevlhzqujrtucppacl` 是重新创建并连接现有 GitHub Pawside 仓库的新项目。因此不存在可执行的跨项目 legacy 数据迁移来源。
- 用户已确认：原同名/旧 Supabase 项目及其数据已删除，当前 `sbwevlhzqujrtucppacl` 是重新创建并连接现有 GitHub Pawside 仓库的新项目。因此不存在可执行的跨项目 legacy 数据迁移来源。
- 新式 publishable key 请求 REST OpenAPI 根端点返回 401：该元数据端点要求 secret key。本轮不会索取或使用 service-role/secret key。
- 对应用依赖的 14 张现有表执行只读 `select=*&limit=1` 探测，全部返回 schema-cache 404：这些表对目标项目的 publishable role 不存在或未暴露。
- Auth settings 端点返回 200，signup 未禁用；目标项目 API 与 key 本身可用。
- Storage bucket list 返回 200，匿名可见 bucket 数为 0；这不能排除 private/未授权 bucket。
- 因此，本文的数据库结论分成：
  - **Migration-confirmed**：仓库 migration 可证明；
  - **Code-contract inferred**：代码读写可证明字段契约，但建表、FK、RLS 不在仓库；
  - **Remote-probed**：目标项目对应用已知 public 表均返回 404，当前前端不能直接运行；
  - **Remote UNKNOWN**：完整 schema、FK、policy、trigger 与 private bucket 仍需 SQL/schema dump 才能证明。

### 1.3 审计前工作区状态

- 已修改：`.claude/settings.local.json`
- 未跟踪：`supabase/.temp/`、`supabase/seeds/batches/`、`supabase/seeds/seed_part1_foods.sql`、`seed_part2_nutrition.sql`、`seed_part3_aliases.sql`、`tsconfig.tsbuildinfo`
- 本轮不覆盖、不删除这些内容。

## 2. 技术栈

| 层 | 当前实现 |
|---|---|
| Web | Next.js App Router `^16.2.2`、React `^19`、TypeScript strict |
| UI | Tailwind CSS 3、移动端最大宽度 480px、Recharts |
| Backend | Next.js Route Handlers + 页面直接调用 Supabase |
| Data/Auth | Supabase Postgres/Auth/SSR client |
| AI | OpenAI 或 DeepSeek 的 OpenAI-compatible Chat Completions；可选 Cloudflare AI Gateway |
| PWA | manifest、SVG icon、Apple touch icon、viewport 配置 |
| Validation | 浏览器约束 + 手写条件；无 Zod、无共享 DTO、无生成的 Database types |
| Test | 仓库内未发现 test/spec 文件或测试脚本 |

依赖存在一个基线不一致：运行时 Next 是 16.2.2，而 `eslint-config-next` 是 15.2.4；`lint` 脚本仍为已被 Next 16 移除的 `next lint`。

## 3. Route Tree

### 3.1 页面路由

```text
/
└── 服务端读取 auth + user_profiles.onboarding_completed
    ├── 未登录 → /auth
    ├── 未 onboarding → /onboarding
    └── 已完成 → /home

/auth
├── 登录
└── 注册
    ├── /auth/forgot-password
    └── /auth/reset-password

/onboarding
/home
/workout
└── /workout/[id]/edit
/food
└── /food/[id]/edit
/body-metrics
/history
└── /history/[date]
/weekly
/settings
```

当前不存在页面路由：`/today`、`/training/[prescriptionId]`、`/method`、`/progress`、独立 Recovery、独立 Daily Review、Body Photo/Capture。

### 3.2 页面用途

| Route | 当前用途 | 主要数据源 |
|---|---|---|
| `/auth` | 邮箱密码登录/注册 | Supabase Auth；登录后读 `user_profiles` |
| `/auth/forgot-password` | 发送重置邮件 | Supabase Auth |
| `/auth/reset-password` | 监听 recovery event 并更新密码 | Supabase Auth |
| `/onboarding` | 目标、性别、身高、体重、周训练目标、每日热量目标 | 直接更新 `user_profiles` |
| `/home` | 训练/饮食/周目标/streak/AI 复盘/体重趋势/快捷入口 | 7 个并行 Supabase 查询 + `/api/ai/daily-review` |
| `/workout` | 自由创建完成后的训练日志 | 直接写 `workout_logs` |
| `/workout/[id]/edit` | 编辑 legacy workout JSON | 直接读写 `workout_logs` |
| `/food` | 手动食物搜索、重量、热量、蛋白质记录 | 查结构化食物库，但直接写 `food_logs` JSON |
| `/food/[id]/edit` | 编辑 legacy food JSON | 直接读写 `food_logs` |
| `/body-metrics` | 体重、体脂、肌肉量、围度、自定义指标 | 直接写 `body_metrics` |
| `/history` | 按日期聚合训练/饮食/身体是否有记录 | 直接查 3 张 legacy 表 |
| `/history/[date]` | 当日详情、编辑/删除入口、AI Review | 直接查/删 legacy 表 + AI API |
| `/weekly` | 自然周计数、时长、热量、体重趋势 | 页面内直接聚合 legacy 表 |
| `/settings` | Profile、目标、旧 targets、单位、AI 模型、CSV 导出、退出 | 直接读写 Supabase |

### 3.3 API routes

```text
/api/workout                  GET, POST
/api/food                     GET, POST
/api/body-metrics             GET, POST
/api/weekly                   GET
/api/daily-summary            GET
/api/export                   GET
/api/foods/search             GET
/api/foods/[id]/nutrition     GET
/api/ai/plans                 GET, POST
/api/ai/daily-review          GET, POST, PATCH
```

## 4. Component Tree

当前没有按业务域拆分的组件目录；大部分业务 UI 和数据访问都在 page 文件中。

```text
app/layout.tsx
├── 全局 metadata / PWA / viewport
└── pages
    ├── app/home/page.tsx
    │   ├── Home Dashboard（内联）
    │   ├── “今天想做什么？”Popup（内联）
    │   ├── AI Review Preview（内联）
    │   ├── Weight LineChart（内联）
    │   └── BottomNav
    ├── app/workout/page.tsx
    │   └── Workout Form / Exercise rows（全部内联）
    ├── app/food/FoodPageClient.tsx
    │   ├── Food Form
    │   └── FoodRow（同文件局部组件）
    ├── app/body-metrics/page.tsx
    │   └── Body Form（内联）
    ├── app/weekly/page.tsx
    │   ├── Weekly summary
    │   ├── BarChart
    │   └── LineChart
    ├── app/history/[date]/page.tsx
    │   ├── Day detail
    │   ├── AI Review
    │   └── Delete confirmation
    └── app/settings/page.tsx

components/
├── BottomNav.tsx   首页 / 历史 / 周报 / 设置
├── PageHeader.tsx  标题 + 可选返回按钮
└── Toast.tsx       2.5 秒 success/error toast + hook
```

特别标记：

- **Home Dashboard**：`app/home/page.tsx`
- **Workout Form**：`app/workout/page.tsx`；编辑版在 `app/workout/[id]/edit/page.tsx`
- **Food Form**：`app/food/FoodPageClient.tsx`；编辑版没有食物库自动匹配
- **Body Form**：`app/body-metrics/page.tsx`
- **Weekly**：`app/weekly/page.tsx`
- **Review**：没有独立组件；Home preview 与 History detail 各自实现
- **Navigation**：`components/BottomNav.tsx` 和 `components/PageHeader.tsx`

## 5. 当前数据库 Schema

### 5.1 Migration-confirmed tables

仓库只有一个 migration：`supabase/migrations/20260413000000_v3_food_schema.sql`。

| 表 | 关键字段 | FK / 唯一约束 | RLS | 当前前端使用 |
|---|---|---|---|---|
| `foods` | serial `id`, `canonical_name`, category, default_unit, density, edible ratio, source, is_active | `canonical_name unique` | 开启；`select using (true)` | `/food` 搜索直接使用；两个 foods API 使用 |
| `food_aliases` | serial `id`, integer `food_id`, alias, alias_type | `food_id → foods.id on delete cascade`; `(food_id, alias) unique` | 开启；公开 select | `/food` 与 search API 使用 |
| `food_nutrition` | serial `id`, integer `food_id`, basis_type, kcal/protein/fat/carb/fiber/sodium, data_version | `food_id → foods.id`; `food_id unique` | 开启；公开 select | 作为 nested relation 被搜索/UI/API读取 |
| `food_portion_templates` | serial `id`, integer `food_id`, portion_name, `weight_g`, note | `food_id → foods.id`; `(food_id, portion_name) unique` | 开启；公开 select | 仅 nutrition detail API 读取；当前页面不消费 |
| `user_food_logs` | uuid `id`, `user_id`, `log_date`, meal_type, input_mode, raw_input_text, notes | `user_id → auth.users.id on delete cascade` | 开启；用户 own-row all | **未使用** |
| `user_food_log_items` | uuid `id`, `food_log_id`, optional `food_id`, raw/resolved name, weight, quantity, unit, estimated/confidence, 4 macro values, `calculation_basis`, status | `food_log_id → user_food_logs.id`; `food_id → foods.id` | 开启；通过 parent ownership | **未使用** |
| `daily_nutrition_summary` | uuid `id`, `user_id`, `log_date`, 4 totals, meal_count | `user_id → auth.users.id`; `(user_id, log_date) unique` | 开启；用户 own-row all | **未使用** |

补充事实：food seed 数据宣称 1,697 个 canonical food + nutrition rows，但本轮未连接远端验证实际 seed 是否已执行。migration 使用 integer/serial food ID；实际 System Spec v0.1 示例使用 UUID，当前两者并不一致。

### 5.2 Code-contract inferred legacy tables

下表的字段来自真实 select/insert/update/export 代码。由于仓库没有这些表的 migration，FK、default、constraint、trigger、RLS 均不能从当前 checkout 证明。

| 表 | 代码可证明的关键字段 | 关联方式 | RLS/FK 证据 | 当前使用 |
|---|---|---|---|---|
| `user_profiles` | `id`, email, goal, gender, height_cm, `weight_kg`, weight_unit, `weekly_workout_target`, `daily_calorie_target`, onboarding_completed, preferred_model, updated_at | `id = auth user id` 由代码假设 | UNKNOWN | Auth、Onboarding、Home、Workout、Body、Weekly、Settings、Review |
| `workout_logs` | id, `user_id`, `date`, type, duration_minutes, notes, `exercises JSON`（name/sets/reps/weight）, updated_at | 以 `user_id` 查询 | UNKNOWN | Home、Workout、History、Weekly、Review、Export |
| `food_logs` | id, `user_id`, `date`, meal_type, `foods JSON`（name/weight_g/calories/protein_g）, updated_at | 以 `user_id` 查询 | UNKNOWN | Home、Food、History、Weekly、Review、Export |
| `body_metrics` | id, `user_id`, `date`, weight_kg, body_fat_pct, `muscle_mass`, 多围度字段, custom_metrics, notes | 以 `user_id` 查询 | UNKNOWN | Home、Body、History、Weekly、Review、Export |
| `weekly_summary` | user_id, week_start, workout_count, total_duration, food_log_count, avg_calories, weight_change | 以 `user_id` 导出 | UNKNOWN | 只有 `/api/export` 读取；页面周报不读取 |
| `ai_plans` | id, user_id, plan_type, status, source, input_snapshot, plan_json, summary_text, prompt_version, created_at | 以 `user_id` 查询 | UNKNOWN | 仅 skeleton API |
| `ai_generated_content` | user_id, content_type, target_date, content_json, content_text, prompt_version, feedback | 代码假设 `(user_id, content_type, target_date)` 可 upsert | UNKNOWN | Daily summary、Daily Review、feedback、cache invalidation |

### 5.3 当前 schema 可复现性

- 当前 checkout 不能从空库重建整个应用：缺少 7 张 legacy 表及其 RLS/migration。
- 没有 `supabase/config.toml`、schema dump、generated database types 或 migration test 配置。
- 不能从 `weekly_summary` 表名推导它是否由 trigger、job 或 API 写入；仓库里没有写入代码。
- 目标项目 `sbwevlhzqujrtucppacl` 对上述 7 张 legacy 表及仓库 migration 定义的 7 张 food 表均返回 schema-cache 404；所以仓库 migration 尚未形成可供当前应用使用的远端 schema，或相关表未授予 publishable role。

## 6. 数据如何进入系统

### 6.1 主要写入路径

```text
Onboarding page ───────────────→ user_profiles
Settings page ────────────────→ user_profiles
Workout page/edit ────────────→ workout_logs.exercises JSON
Food page/edit ───────────────→ food_logs.foods JSON
Body page ────────────────────→ body_metrics
AI Review route ──────────────→ ai_generated_content
AI Plans skeleton route ──────→ ai_plans
```

当前正式页面大多绕过 API，直接从浏览器 Supabase client 读写。除 AI Review 外，现有 API routes 基本没有被当前页面 `fetch()` 消费。

### 6.2 API/Server Action 现状

- 没有使用 Next.js Server Actions（未发现 `"use server"`）。
- `/api/workout`、`/api/food`、`/api/body-metrics`：有鉴权的 GET/POST，但 UI 不使用。
- `/api/body-metrics` 使用 `{ user_id: user.id, ...body }`，请求体可覆盖前面的 `user_id`；实际隔离依赖未知 RLS。
- `/api/weekly` 与页面 `/weekly` 各自重复实现聚合；页面不调用 API。
- `/api/export` 与 Settings 页面各自重复实现 CSV 导出；页面不调用 API。
- `/api/daily-summary` 是 rule summary cache；当前 UI 不调用。
- `/api/foods/search` 与 `/api/foods/[id]/nutrition` 无显式用户鉴权，且 API 路径被 middleware 排除；当前 migration 允许匿名公开读取 reference food tables。
- `/api/ai/plans` 只保存 placeholder draft，没有真实计划生成。
- `/api/ai/daily-review` 是当前唯一被页面使用的业务 API。

### 6.3 Dashboard data fetching

Home 页面直接并行请求：Profile、今日 workout、今日 food、本周 workout、近 14 条 body metric、近 60 天 workout dates、近 60 天 food dates；随后客户端计算 weekly count、streak、weight trend。AI review 另发 POST。

这意味着 Dashboard 当前是客户端拼装，不存在统一 aggregator、统一 snapshot version 或服务端一致性边界。

## 7. Type / Validation

### 7.1 可复用内容

- `tsconfig.json` 开启 `strict`。
- 现有页面和 AI helper 有局部 interface，可作为梳理 DTO 的输入材料。
- AI preprocessor 已把 calorie/protein/duration/completeness 的手写规则与 prompt 调用部分分开。
- 食物页有确定性 `per100g × weight / 100` helper，但只计算 calories/protein，且结果仍可手改。

### 7.2 当前缺口

- 无 Zod 依赖、无 runtime schema validation。
- 无 shared request/response DTO；同一个 Workout/Food/Profile shape 在多处重复且不一致。
- 无 Supabase generated types，所有 `.from()` 基本为弱类型推断。
- API 普遍直接 `await req.json()`；字段范围、日期格式、数值范围、unknown-key stripping 未统一处理。
- `body-metrics` API 接受并 spread 任意 body。
- 编辑页按 `id` 读取/更新，未在 query 中追加 `user_id`；所有权完全依赖未核验 RLS。
- 食物新增页会自动算 calories/protein，但允许用户直接覆盖；编辑页不再关联 food ID/per-100g basis，无法可追溯重算。

## 8. Auth / Route Protection / RLS

### 8.1 Auth

- 使用 Supabase email/password sign-up、sign-in、sign-out、reset password、update password。
- Root page 服务端检查 user 与 onboarding 状态。
- 登录页登录后检查 `user_profiles.onboarding_completed`。

### 8.2 Route protection

- middleware 对非 `/auth*` 页面执行 `getUser()`；未登录重定向 `/auth`。
- 所有 `/api/*` 被显式排除于 middleware 重定向，但绝大多数 API route 内部自行 `getUser()` 并返回 401。
- middleware 只按“登录/未登录”保护，不检查 onboarding，也没有 method enrollment guard。
- 客户端页面又重复使用 `getSession()`/router redirect。

### 8.3 RLS

- 仓库可证明：7 张结构化食物表均启用 RLS；3 张用户表按 `auth.uid()` 或 parent ownership 隔离；4 张 reference 表公开 select。
- 仓库不能证明：`user_profiles`、`workout_logs`、`food_logs`、`body_metrics`、`weekly_summary`、`ai_plans`、`ai_generated_content` 的 RLS。
- 由于 UI 大量直接访问 Supabase，legacy RLS 不是可选防线，而是核心安全边界；上线前必须从远端导出并纳入 migration。

## 9. Storage / Media

- 代码中没有 `supabase.storage`、bucket、upload、signed URL 或 media lifecycle 调用。
- migration 中没有 storage bucket/policy。
- 当前没有 Body Photo、Food Photo、Exercise Media、Capture Session 页面或 API。
- 匿名 bucket list 返回 0；结合用户确认这是新项目，目前没有旧项目媒体需要迁移。private bucket/policy 仍需在后续 Storage Phase 以受权 SQL/API 结果核验。

## 10. AI / Review

### 10.1 当前实现

- `lib/ai-rules.ts` 对 legacy workout/food/profile/body 做规则预处理。
- `lib/ai-client.ts` 调 OpenAI `gpt-4o-mini` 或 DeepSeek `deepseek-chat`；无 key/调用失败时返回 null。
- `/api/ai/daily-review` 先读 cache，再预处理，再调用 AI；失败后使用 `generateDailySummary()` rule fallback。
- 输出只做最低限度 shape 检查：summary string、insights/actions array；没有 Zod、字段枚举/长度完整校验。
- cache 存入 `ai_generated_content`，带 `prompt_version`；代码未保存完整 input snapshot、model response evidence 或 rule version snapshot。
- Review 输入没有 prescription、method、progression、recovery、fat/carb、结构化 calculation basis。

### 10.2 当前失效链

- Workout/Food 页面和对应编辑/删除路径会删除当日 `daily_review_ai` cache。
- Body 页面保存后不 invalidates Review。
- `/api/workout`、`/api/food`、`/api/body-metrics` 写入后不 invalidates Review。
- 修改日志日期时只 invalidates 新日期，旧日期 cache 可能继续存在。
- `daily_summary` cache 没有对应 invalidation。
- `sessionStorage` 的 Home/History AI cache 不随数据库 stale 状态自动清理。
- Weekly 页面每次重算，因此没有 stale cache，但逻辑与 `/api/weekly` 重复。

## 11. 当前真实功能能力

### 已实现

- Auth、Onboarding、中文移动端页面壳与基础导航。
- 自由训练日志 CRUD（创建、编辑、History 删除）。
- 自由饮食日志 CRUD；新增页可搜索结构化 food reference。
- Body metrics 新增与 History 删除。
- Home 的训练/饮食/本周/连续记录/AI summary/体重趋势。
- History 日期聚合与详情。
- Weekly 计数、时长、热量、体重图表。
- AI Daily Review + rule fallback + like/dislike feedback。
- CSV 导出。

### 尚未实现

- Method、Enrollment、Cycle、Prescription、Workout Runtime、Set Actual。
- Calibration、versioned Progression、Recovery decision。
- Checklist engine、Cycle progress、Milestone/Badge/Title、Progress page。
- 标准化 Meal/Item 正式写入、daily nutrition summary 正式消费、nutrition target service、自然语言 parse。
- Body Photo/Capture、Storage、Exercise media mapping。
- Dashboard aggregator、domain events、analytics events、统一 invalidation。

## 12. 基线质量检查

| 检查 | 结果 |
|---|---|
| TypeScript | `npm.cmd exec tsc -- --noEmit --incremental false` 无诊断输出（通过） |
| Lint | 失败：`next lint` 被 Next 16 当作目录参数，报 `Invalid project directory ... D:\Pawside\lint` |
| Tests | 无测试脚本、无 test/spec 文件 |
| Migration validation | 未配置本地 Supabase/DB runner；未执行远端 migration |
| RLS review | 仅静态核验仓库内 food migration；legacy/remote 未验证 |
| API smoke | 未启动 app、未使用真实账号，未做运行时 smoke |
| Mobile smoke | 仅代码层确认 mobile-first classes/viewport；未做浏览器视觉 smoke |

以上是 Phase 0 当前真实实现基线，不代表 Pawside 2.0 的目标状态。
