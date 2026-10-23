# 数据模型、接口与状态机（草案）

**全部是设计草图，没有应用到任何数据库。** DDL 片段只表达意图，真正迁移要按仓库规范（RLS、授权、`USER_DATA_TABLES` 登记、本地仿真验证）重写。
**Storage 相关策略无法在本地仿真环境验证**（仿真库没有 Storage），上线前必须在真实 Supabase 上验证。

## 1. 实体关系

```mermaid
erDiagram
  AUTH_USERS ||--o{ COACH_CONVERSATIONS : owns
  COACH_CONVERSATIONS ||--o{ COACH_MESSAGES : has
  COACH_MESSAGES ||--o{ COACH_MEDIA : "attachments"
  COACH_CONVERSATIONS ||--o{ COACH_DRAFTS : has
  COACH_DRAFTS }o--o{ COACH_MEDIA : "meal draft uses (payload.media_ids)"
  AUTH_USERS ||--o{ COACH_PREFERENCES : has
  AUTH_USERS ||--o{ RECIPE_FEEDBACK : gives
  RECIPES ||--o{ RECIPE_FEEDBACK : receives
  RECIPE_SOURCES ||--o{ RECIPES : provides
  AUTH_USERS ||--o{ RECIPE_RECOMMENDATIONS : shown
  RECIPES ||--o{ RECIPE_RECOMMENDATIONS : in
  AUTH_USERS ||--o{ COACH_NUDGES : receives
  AUTH_USERS ||--o{ COACH_EVENTS : emits
  COACH_DRAFTS ||--o| USER_FOOD_LOGS : "commit → (existing)"

  COACH_MEDIA {
    uuid id PK
    uuid user_id FK
    text kind "food_photo | voice"
    text object_key "food/{user}/{id}.jpg"
    text mime
    int bytes
    int width
    int height
    text status "uploading|uploaded|analyzing|analyzed|failed|expired|deleted"
    jsonb analysis "candidates, unknowns; no user text"
    timestamptz retention_until
    timestamptz created_at
  }
  COACH_PREFERENCES {
    uuid id PK
    uuid user_id FK
    text layer "hard | soft"
    text category "allergy|avoid_food|diet|taste|cooking|time"
    text subject
    jsonb detail
    text source "explicit|settings|feedback"
    timestamptz expires_at "null = until changed"
    timestamptz revoked_at
  }
  RECIPE_SOURCES {
    uuid id PK
    text platform "bilibili"
    text handle
    text url
    bool active
  }
  RECIPES {
    uuid id PK
    uuid source_id FK
    text external_id
    text title
    text url
    text cover_url "nullable; never mirrored"
    text fetch_status "ok|partial|unavailable"
    int duration_min "nullable"
    jsonb ingredients "nullable"
    jsonb author_calories "labelled as author-stated; never intake"
    timestamptz fetched_at
    bool active
  }
  RECIPE_FEEDBACK {
    uuid id PK
    uuid user_id FK
    uuid recipe_id FK
    text action "like|dislike|favorite|unfavorite|swap|open"
    uuid request_id "dedupe"
  }
  RECIPE_RECOMMENDATIONS {
    uuid id PK
    uuid user_id FK
    uuid recipe_id FK
    timestamptz shown_at
    jsonb context "hard filters applied, reason codes"
  }
  COACH_NUDGES {
    uuid id PK
    uuid user_id FK
    text kind "weekly_review|recipe_idle|pending_draft"
    text ref_id
    date local_date
    timestamptz shown_at
    timestamptz dismissed_at
  }
  COACH_EVENTS {
    uuid id PK
    uuid user_id FK
    text name
    jsonb props "ids and counts only"
    uuid request_id "dedupe"
    timestamptz at
  }
```

### 与现有表的衔接（不破坏）
- `coach_drafts.kind` 的检查约束要扩展（目前 `meal|meal_edit|workout|weight`）。新增草稿类型**尽量不要**：照片/语音/食谱最终都落到现有 `meal` 草稿，只在 payload 里加 `media_ids`、`source: 'photo'|'voice'|'recipe'`。这样确认、幂等、版本检查、导出删除全部复用。
- `ai_generations.surface` 已含 `coach_chat`；视觉识别、转写是**不同的模型调用**，建议新增 `coach_vision`、`coach_transcribe` 两个 surface（要改约束；或统一记在 `coach_chat` 下用 `scope_id` 区分，省一次改约束）。
- `USER_DATA_TABLES`：以上每张用户表都要登记（`tests/account/user-data-coverage.test.ts` 会拦）。`recipes`/`recipe_sources` 不是用户数据，不登记。
- 所有新增用户表 RLS：本人读写；`user_id` 不可重分配（沿用 `coach_*` 的策略写法）。

## 2. 对象存储（草图）

桶：`coach-media`（私有）。路径：`food/{user_id}/{media_id}.jpg`、（语音若需临时落盘）`voice/{user_id}/{media_id}.m4a`。

```sql
-- 仅表达意图；未验证
create policy coach_media_own_read on storage.objects for select to authenticated
  using (bucket_id = 'coach-media' and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy coach_media_own_write on storage.objects for insert to authenticated
  with check (bucket_id = 'coach-media' and (storage.foldername(name))[2] = (select auth.uid())::text);
-- 不提供 update/delete 给客户端：删除走服务端接口，便于同时清元数据
```
服务端校验（不信任客户端）：魔数（JPEG `FFD8FF` / PNG / WebP `RIFF…WEBP`）、字节数上限、尺寸上限；不匹配则 `status=failed` 并删对象。

## 3. 状态机

### 3.1 媒体（照片）
```mermaid
stateDiagram-v2
  [*] --> uploading: 申请签名上传 URL
  uploading --> uploaded: 客户端 complete + 服务端校验魔数/大小
  uploading --> failed: 超时/校验失败
  uploaded --> analyzing: 触发识别
  analyzing --> analyzed: 得到候选
  analyzing --> failed: 超时/非食物/模型失败（可重试）
  analyzed --> expired: 保留期到
  uploaded --> expired: 保留期到
  analyzed --> deleted: 用户删除/账号删除
  failed --> deleted
  expired --> deleted: 清理任务
  deleted --> [*]
```

### 3.2 一次照片记录（对话层，沿用草稿状态机）
```mermaid
sequenceDiagram
  actor U as 用户
  participant C as 小爪面板
  participant S as Storage
  participant API as /api/coach/*
  participant V as 视觉适配器
  participant R as resolveItems(已有)
  participant D as coach_drafts(已有)
  U->>C: 选图/拍照
  C->>C: 压缩 + 去EXIF（浏览器）
  C->>API: POST media/upload-url
  API-->>C: 签名URL + media_id
  C->>S: PUT 图片（直传）
  C->>API: POST media/{id}/complete
  API->>API: 校验魔数/大小/所有权
  U->>C: 点发送（可带文字/语音转写）
  C->>API: POST chat {media_ids, text}
  API->>V: 识别（独立请求，带超时）
  V-->>API: 食物候选+份量范围+不确定项
  API->>R: 匹配/份量/估算（复用）
  R-->>API: 条目 + 营养(服务端算)
  API->>D: 草稿(payload.media_ids)
  API-->>C: 卡片（可确认）
  U->>C: 点确认保存
  C->>API: confirm(draft, version)
  API->>D: 提交(同一路径)
```

### 3.3 多图分组（Patch §3.3）
```mermaid
flowchart TD
  A[收到 N≥2 张图] --> B{用户文字已说明分组?}
  B -- 是 --> G[按说明分组]
  B -- 否 --> Q{追问预算还在?}
  Q -- 是 --> Ask["问：同一餐，还是不同餐？<br/>选项：同一餐 / 分开（第1张早餐…）"]
  Q -- 否 --> U["保留为未归属草稿<br/>不伪造餐数，提示待补"]
  Ask --> G
  G --> H[重复视角合并：同一份食物不相加]
```

## 4. 接口草图

均需登录 + `coach_chat` 功能位；业务结果统一 200 + `status`（与现有约定一致）。

| 方法 路径 | 用途 | 关键校验 |
|---|---|---|
| `POST /api/coach/media/upload-url` | 申请签名上传（`{kind, mime, bytes}`） | 类型白名单、大小上限、每日配额 |
| `POST /api/coach/media/[id]/complete` | 上传完成通知 | 魔数、实际大小、所有权；失败则删对象 |
| `POST /api/coach/media/[id]/analyze` | 食物识别（同步，带超时） | 状态必须是 `uploaded`；幂等（已 analyzed 直接返回） |
| `DELETE /api/coach/media/[id]` | 删除对象+元数据 | 所有权；级联到引用它的未确认草稿（置为失效） |
| `POST /api/coach/transcribe` | 语音转写（`multipart`，≤60s） | 类型/大小/频率限制；不落盘或处理后立即删 |
| `GET/POST/PATCH/DELETE /api/coach/preferences` | 偏好管理 | 本人；硬限制写入需 `explicit` 来源 |
| `POST /api/coach/recipes/recommend` | 推荐（返回真实入库候选） | 先过硬限制，再软偏好排序，近期去重 |
| `POST /api/coach/recipes/[id]/feedback` | 点赞/踩/收藏/换一个/打开 | `request_id` 幂等 |
| `GET /api/coach/nudge` / `POST …/[id]/dismiss` | 当天气泡 | 服务端按当地日期限频 |
| `GET /api/coach/training/continue` | 继续今天的计划（只读） | 不写任何训练数据 |

## 5. 错误分类（用户看到什么）

| 类别 | 例 | 用户文案原则 | 可重试 |
|---|---|---|---|
| 鉴权/权限 | 未登录、无权限 | 明确、不泄露存在性 | 否 |
| 校验 | 图太大、格式不支持、录音太长 | 说出具体限制和怎么办（"换 JPEG/PNG/WebP"） | 是（改后） |
| 配额 | 今日上传/转写次数到上限 | 说明明天恢复 + 可改用文字 | 否 |
| 超时 | 识别/转写超时 | "没认出来，可以换文字或再试一次" | 是 |
| 依赖不可用 | 模型/存储/转写服务故障 | 保留已输入内容；不伪装识别完成 | 是 |
| 冲突 | 草稿版本过期 | 说明已更新，看最新那张 | 否 |
| 结果未知 | 提交时断网 | 沿用现有 outcome_unknown 流程 | 是（幂等） |

## 6. 事件（Patch §12 埋点建议；只含 id 和计数，不含原文/图片/音频）

`chat_open` · `meal_input_started{mode:text|photo|voice|photo+voice}` · `media_uploaded{count,bytes}` · `analysis_done{latency_ms,candidates}` · `draft_ready` · `clarification_shown{about}` · `draft_corrected{op}` · `log_commit_success|failure{kind}` · `raw_log_saved` · `recipe_shown|changed|liked|disliked|favorited|opened` · `nudge_shown|dismissed{kind}` · `next_session_started`。
按 `request_id` 去重。**不做**：把任何事件接到第三方分析 SDK（隐私页承诺没有）。
