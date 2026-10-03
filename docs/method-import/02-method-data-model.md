# 方法论导入大更新 · 文档 2：方法数据模型

- 状态：草案 v0.1
- 日期：2026-10-03
- 前置：文档 0（总纲）、文档 1（数据架构）。本文落实原则 P1、P3、P5、P7 与硬约束 H1–H10。
- 配套文件：`sql/02-draft-migrations.sql`（增量 DDL 草案，不是迁移，未在线上执行）

## 0. 关卡记录（G1–G4）

**G1 检索**：读取了 `initialize_current_method_enrollment`、`start_method_session_v2/v3`、`complete_method_session_v2`（`20260925000500` 最新版）、`create_session_prescription_for_cycle`、`create_program_day_prescription`、保护触发器（`20260909000200`）、方法相关行级安全（`20260904000200`、`20260909000400`）、`api/training/today/route.ts`、`lib/method-availability.ts`、`lib/method-catalog.ts`。在本地 PostgreSQL 16 中回放 master 全部 27 个迁移，再依次应用文档 1、文档 2 的草案并实测。

**G2 审核**

| 类别 | 内容 |
|---|---|
| 已核实（读到代码） | 开始训练 v2/v3 对分化键没有写死；写死集中在完成训练函数、程序日生成函数、报名函数、5 处检查约束、前端类型；`methods` 已有 `source_type in ('official','imported')`，表结构预留了"导入方法"；`planned_for_date` 在代码里只被读取，没有拦截逻辑 |
| 已实测（本地） | 见第 9 节：分化键放宽、下一练函数与现有写死逻辑在 1.2 的 8 种账本状态下完全一致、日志类型函数与现有 CASE 一致、私有方法可见性、可选日不阻塞一轮、账号删除级联、直接删除仍被阻止、两份草案前后事实表哈希一致 |
| 推断 | 线上结构与本地回放一致 |
| 未核实 | 完成训练函数在 Patch B 合并后的最终形态（B5 迁移整函数重定义了它）；`method_runtime_set_templates` 在线上的行数 |

**G3 影响面**：本文新增项见第 10 节，并入文档 0 附录 A。
**G4 冲突**：本文要求新增 `complete_method_session_v3`，它必须基于 Patch B 合并后的最新定义，否则会丢掉 B5 的时长逻辑（文档 0 附录 C）。

## 1. 目标

让系统能承载"任意日数、任意日类型"的方法，同时保证：
- 1.2 三分化的行为一字不差（S6）。
- 私有方法只有创建者能看到（S2 的前提）。
- 激活后的方法不可变，个性化走调整层（P5）。

## 2. 现状与差距

**已经通用的部分（无需改动）**
- 开始训练 `start_method_session_v2/v3`：不含任何分化键写死；所需训练时长到"必须完成的动作数"的换算是 `ceil(原动作数 × 分钟 / 60)`。
- 处方生成的核心 `insert … select`：按 release 里的分化日取动作与逐组模板，本身是通用的。
- 今日接口返回的分化日名称取自 `method_splits.name_zh`，只有名称兜底表是写死的。

**必须改动的写死点**

| 层 | 位置 | 内容 |
|---|---|---|
| 数据库约束 | `method_splits.key`、`method_enrollments.next_split_key`、`session_prescriptions.split_key`、`workout_sessions.split_key`、`method_source_chunks.split_key` | 只允许 push/pull/legs。**`method_splits.key` 的约束会直接阻止新分化日入库**，是上线的第一道硬门槛 |
| 完成训练 | `complete_method_session_v2`（`20260925000500`：日志类型 `:469-474`，账本写入 `:512-516`，轮转 `:518-527`，整轮结束回首日 `:537`、`:545`） | 轮转写死 `values ('push',1),('pull',2),('legs',3)`；整轮结束回到 `'push'`；日志类型 `case … else '腿'` |
| 程序日生成 | `create_program_day_prescription`（`20260925000300:42`） | 校验键只能是三者之一 |
| 报名 | `initialize_current_method_enrollment`（`20260910000100:133,192,216`） | 写死方法键 `ksw_tcy_three_split_2026` 与首日 `'push'`，且要求器械为 `full_gym` |
| 权限 | `methods_authenticated_read`（`using (true)`）与 5 个"已激活即可读"策略 | 没有归属概念，直接加私有方法会泄露给所有登录用户 |
| 保护触发器 | `protect_active_method_release`、`protect_active_method_content` | 禁止删除激活的 release 及内容，**连级联删除也禁止**，会让账号删除失败（已实测） |
| 前端与接口 | 见第 8 节 | 类型联合、`PROGRAM_DAY_ORDER`、文案 |

## 3. 方法清单（manifest）

manifest 是导入管线（xlsx 路径与 AI 抽取路径共用）的唯一输出，也是写库的唯一入口。下面是 TypeScript 的 zod 草案，真正的文件放 `lib/contracts/method/manifest.ts`。

```ts
const Authority = z.enum([
  'method_explicit',            // 原文明写
  'official_reconstructed',     // 官方素材重建
  'product_execution_default',  // 产品默认值
  'unresolved',                 // 未解决
  'library_default',            // 金标动作库默认值（新）
  'ai_inferred',                // AI 推断，需用户确认（新）
  'user_corrected',             // 用户更正（新）
])

const Sourced = <T extends z.ZodTypeAny>(value: T) => z.object({
  value: value.nullable(),
  authority: Authority,
  quote: z.string().nullable(),   // 原文片段。authority 为 method_explicit 时必填，且必须能在原文中找到
  confidence: z.enum(['high', 'medium', 'low']),
  note: z.string().nullable(),
})

const SetTemplate = z.object({
  type: z.enum(['warmup', 'working', 'failure', 'rest_pause', 'backoff', 'other']),
  reps: Sourced(z.object({ min: z.number().int(), max: z.number().int(), perSide: z.boolean() })).nullable(),
  durationSeconds: Sourced(z.number().int()).nullable(),   // 时长型动作
  distanceM: Sourced(z.number()).nullable(),               // 距离型动作
  restSeconds: Sourced(z.object({ min: z.number().int(), max: z.number().int() })).nullable(),
  failure: z.enum(['avoid', 'allowed', 'required']),
  optional: z.boolean().default(false),                    // "做 2 至 3 组" 的第 3 组
  qualityNote: z.string().nullable(),
})

const ExerciseRef = z.object({
  name: z.string(),                                        // 原文里的名称
  exerciseId: z.string().uuid().nullable(),                // 对齐到动作库后的 ID
  match: z.enum(['exact', 'alias', 'candidate']),
})

const ExerciseEntry = z.object({
  ref: ExerciseRef,
  role: z.enum(['primary', 'secondary', 'accessory', 'isolation', 'development']),
  sets: z.array(SetTemplate).min(1),
  substitutions: z.array(ExerciseRef).default([]),         // 原文里的"替换动作"
  cues: z.array(z.string()).default([]),
  notes: z.string().nullable(),
})

const Day = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  nameZh: z.string(),
  order: z.number().int().positive(),
  dayType: z.enum(['strength', 'core', 'cardio']),
  required: z.boolean(),                                   // 是否计入"一轮完成"
  minGapDays: z.number().int().min(0).max(7),              // 完成这一天后，建议至少隔几天
  focusRegions: z.array(z.string()),                       // 如 ['胸','三头']
  warmupNotes: z.array(z.string()).default([]),
  cooldownNotes: z.array(z.string()).default([]),
  exercises: z.array(ExerciseEntry),
})

export const MethodManifest = z.object({
  schemaVersion: z.literal(2),
  method: z.object({
    nameZh: z.string(),
    summary: z.string().nullable(),
    level: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
    equipmentRequirement: z.enum(['none', 'home', 'full_gym']).nullable(),
  }),
  source: z.object({
    kind: z.enum(['pasted_text', 'workbook']),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().nullable(),
  }),
  days: z.array(Day).min(1).max(14),
  openQuestions: z.array(z.object({ path: z.string(), question: z.string() })),
  consent: z.object({ version: z.string(), acceptedAt: z.string() }).nullable(), // 私有导入必填
})
```

**与数据库的映射**

| manifest | 写入 |
|---|---|
| `days[]` | `method_splits`（`key`、`name_zh`、`order_index`、`primary_focus` ← `focusRegions`、`day_type`、`is_required` ← `required`、`min_gap_days`） |
| `days[].exercises[]` | `method_split_exercises`（`exercise_id` ← `ref.exerciseId`、`method_role`） |
| 每个动作的处方 | `method_rules`（`rule_type = 'prescription'`）+ `method_prescription_field_values` + `method_runtime_set_templates`（含新增的时长、距离目标） |
| `substitutions` | `method_rules`（`rule_type = 'substitution'`），经 `method_split_exercises.substitution_rule_key` 关联 |
| `cues` | `method_rules`（`rule_type = 'technique'`） |
| `warmupNotes` | `method_rules`（`rule_type = 'warmup'`） |
| `Sourced.authority` | `source_authority`（需放宽约束，见 M9） |
| `source` | `method_source_documents`（校验和不可变身份，沿用现有表） |

**不允许进入 manifest 的内容**：重量、个人化的组次调整（这些属于个人调整层）；任何没有 `quote` 却标为 `method_explicit` 的值（校验器直接拒绝，文档 3）。

**示例（肩部日，来自小黑盒文章；展示一个动作，其余同构）**

```json
{
  "key": "shoulders", "nameZh": "肩", "order": 4, "dayType": "strength",
  "required": true, "minGapDays": 1, "focusRegions": ["三角肌前束","三角肌中束","三角肌后束"],
  "exercises": [{
    "ref": { "name": "哑铃肩推", "exerciseId": null, "match": "candidate" },
    "role": "primary",
    "sets": [
      { "type": "working", "failure": "avoid", "optional": false, "qualityNote": null,
        "reps": { "value": { "min": 8, "max": 10, "perSide": false }, "authority": "method_explicit",
                  "quote": "每组8至10次，做3组，组间休息60秒", "confidence": "high", "note": null },
        "restSeconds": { "value": { "min": 60, "max": 60 }, "authority": "method_explicit",
                  "quote": "组间休息60秒", "confidence": "high", "note": null },
        "durationSeconds": null, "distanceM": null }
    ]
  }]
}
```
上例只写了 1 组模板；"3 组"在写库时展开为 3 行逐组模板。肩部日第四个动作"2 至 3 组"展开为 3 行，其中第 3 行 `optional: true`。

## 4. 日类型、轮转与休息

**日类型**：`strength` / `core` / `cardio`。它们只影响展示和轮转，**不决定每组记什么**。每组记什么由动作的记录形态决定（文档 1 第 4.3 节）。

**一轮（cycle）**：该 release 中所有 `required` 的分化日都完成（或被用户跳过）即为一轮。顺序由 `order_index` 决定，但沿用现有的"程序日可乱序"规则（`execution_mode` 为 `canonical` / `supplemental` / `replay`，不变）。

**可选日不阻塞一轮**：已实测，`cardio` 设为 `required = false` 时，完成"胸"之后 `next_program_day` 返回空，整轮可以结束。若全部设为必需，用户一旦不做有氧，一轮就永远结束不了。

**休息日不是分化日**：用 `min_gap_days` 表达。完成一天之后，下一练的最早建议开始日 = 完成日 + `min_gap_days`。0 表示当天即可，与现状一致。仅作建议，不阻止训练（`planned_for_date` 在现有代码里没有任何拦截）。"四个部位 + 腹肌日 + 有氧日 + 休息一天"这类节奏，用某一天的 `min_gap_days = 2`（中间隔一天）表达。

**跳过**：新增处方状态 `skipped`（不复用 `cancelled`，后者在现有逻辑里表示"作废"，开始训练会拒绝已作废的处方）。账本把 `completed` 与 `skipped` 都视为已解决。1.2 没有 `skipped` 行，所以行为不变。

## 5. 函数契约

### 5.1 已写出并通过实测的
- `next_program_day(p_cycle_id) → text`：该周期中，`required` 且尚无 `completed`/`skipped` 处方的、`order_index` 最小的分化日键；全部完成返回空。**在 1.2 的 8 种账本状态（含乱序）下，与现有写死逻辑结果完全一致。**
- `workout_log_type_for_split(p_enrollment_id, p_split_key) → text`：返回该分化日的 `name_zh`。**对 push/pull/legs 与现有 `case` 结果一致**（推/拉/腿），对新方法返回其自己的名称（如"胸"），修复文档 0 的 A1 误标风险。
- `method_visible_to_user(p_method_id) → boolean`：官方方法或本人拥有的方法。

### 5.2 需要新增的（契约，由车道 A 实现）

| 函数 | 作用 | 关键要求 |
|---|---|---|
| `complete_method_session_v3` | 取代完成函数 | 基于合并后的最新定义；日志类型用 `workout_log_type_for_split`；下一练用 `next_program_day`；整轮结束后首日取最小 `order_index` 的必需日；新处方的 `planned_for_date = 当天 + min_gap_days` |
| `create_session_prescription_for_cycle_v2`、`create_program_day_prescription_v2` | 生成处方 | 分化键校验改为"必须存在于该报名所固定 release 的分化日"；逐组模板复制 `target_duration_seconds`、`target_distance_m` |
| `save_method_set_actual_v2` | 保存一组 | 在原参数基础上增加可空的时长、距离；旧参数形状必须继续可用（H10） |
| `enroll_in_method_release_v1(p_release_id)` | 报名 | 校验可见性；校验基础资料与能力画像；器械要求取自 manifest（私有方法默认不设 `full_gym` 门槛，见 O-12）；同一事务里归档现有 active 报名；`next_split_key` 取首个必需日；建第 1 轮 |
| `create_private_method_v1(p_manifest, p_consent_version)` | 创建私有方法 | 见第 6 节 |
| `skip_program_day_v1`、`apply_adjustment_v1`、`revoke_adjustment_v1` | 个人调整 | 见第 7 节 |

旧函数一律不改（H9）。切换到新函数由 API 路由决定，灰度见文档 5。

## 6. 私有方法

**身份**
- `methods.owner_user_id`（空 = 官方共享）、`hidden_at`（仅从"我的方法库"列表隐藏，不影响读取，因为历史记录仍要显示方法名）。
- `source_type = 'imported'`，现有表结构已预留。
- `methods.key` 全局唯一（`unique(key, version)`）：私有方法的键由系统生成，形如 `u_<用户前 8 位>_<slug>_<4 位随机>`。

**可见性（已实测）**：`methods` 与 5 个 release 级读取策略都加上 `method_visible_to_user`。所有者能看到自己的方法、release、分化日；其他用户看不到；官方 1.2 对所有人仍可见。

**创建顺序是硬约束（已实测）**：激活后的 release 禁止再写入内容。所以 `create_private_method_v1` 必须按顺序：
1. 插入 `methods`（`status = 'active'`、`source_type = 'imported'`、`owner_user_id = auth.uid()`）；
2. 插入 `method_releases`，状态 `validated`、`runtime_gate_status = 'passed'`、`validated_at = now()`；
3. 写入分化日、规则、动作、字段值、逐组模板；
4. 最后把 release 更新为 `active`。

**账号删除（已实测，需修改两个触发器函数）**：现有保护触发器会拒绝由 `methods` 级联而来的删除，账号删除会失败。草案 M13 修改 `protect_active_method_release` 与 `protect_active_method_content`：只放行"所属方法行已不存在"的删除。验证结果：账号删除后私有方法、release、分化日、训练记录、调整全部清理，官方方法不受影响；直接删除激活的 release、分化日、官方 1.2 仍被阻止。

**安全要求（不可缺）**
- 函数必须是 `security definer`，且 `set search_path = ''`。
- 服务端先用 zod 校验，函数内再做结构校验（天数上限、每天动作上限、字符串长度、键格式），不信任客户端。
- 每个用户的私有方法数量与导入频率设上限（数值在文档 5 定）。
- 浏览器端没有 service-role 密钥，写入只能经此函数。

## 7. 个人调整层

激活后的 release 不可变，用户的个性化放在 `user_method_adjustments`（草案 M12）：

| 动作 | 含义 |
|---|---|
| `hide_exercise` | 之后不再出现这个动作 |
| `swap_exercise` | 换成替换列表中的另一个动作（`payload` 指明目标） |
| `set_count` / `rep_range` | 改组数、次数范围 |
| `skip_day` | 跳过这个分化日（对应处方状态 `skipped`） |

**应用时机**
- **生成时**：处方生成函数 v2 读取该报名未撤销的调整，叠加到新处方上。
- **已生成但未开始的处方**：由 `apply_adjustment_v1` 直接改写用户自己的处方行（这些是用户私有快照，不属于共享方法）。
- **已开始的训练**：沿用现有的"选择训练时长 → 必须完成的动作数"机制，不改。

**权限**：用户只读自己的调整，写入经函数。

## 8. 代码改动清单（车道 A）

| 位置 | 改动 |
|---|---|
| `app/api/training/today/route.ts:26-27,82,181-196,249-277` | `PROGRAM_DAY_ORDER` 改为读取该报名所固定 release 的分化日（按 `order_index`）；默认首日改为首个必需日；兜底名称表只作兜底 |
| `app/home/page.tsx:40` | `next_split_key` 类型改为 `string` |
| `app/training/today/page.tsx:39-77` | 同上，5 处类型 |
| `app/training/sessions/[sessionId]/page.tsx:68,119` | 同上，2 处类型 |
| `app/api/method/enroll/route.ts:13`、`app/api/onboarding/route.ts:18` | `next_split_key?: 'push'` 改为 `string` |
| `lib/contracts/method/runtime-defaults.ts:13` | `splitKey` 枚举放宽为格式校验 |
| `lib/method-availability.ts` | 文案里的"三分化""从「推」开始"改为由方法名驱动 |
| `lib/method-catalog.ts`（196 行手写副本） | 改为读库；原内容保留为回归测试 fixture |
| `app/training/method/page.tsx`、`[exerciseKey]/page.tsx` | 数据来源由 catalog 改为读库 |
| `app/workout/page.tsx:9` | 自由记录类型词表补充"腹肌" |
| `app/api/method/current/progress/route.ts:32`（最终复扫补入） | 目前读取 `method_cycles` 的 `push_session_id / pull_session_id / legs_session_id`，新方法这三列为空。改为按 `session_prescriptions` 的状态按分化键汇总各天完成情况；保留原有返回字段与 `kind: 'not_enrolled'`（`tests/api/normal-state-http.test.ts` 对该文件文本有断言），只做增量。目前没有界面调用这个接口，只有测试引用 |
| `lib/coach/display.ts:43`、`lib/coach/workout-context.ts:149,300`、`lib/evidence/daily-review.ts:19`（Patch B 链，最终复扫补入） | `SPLIT_LABELS` 写死 push/pull/legs 三项，并且未知键回落为**原始键**，会把 `chest` 这类英文内部值带进教练文案与日复盘证据。改为用 `method_splits.name_zh`（经 `workout_log_type_for_split`）取名，未知时宁可不显示也不显示原始键 |
| Patch B 的 B8 | 酸痛部位对照集中成单一函数，后续改读 `method_splits.primary_focus` |

## 9. 已完成的本地实测

环境：PostgreSQL 16，master 全部 27 个迁移回放，依次应用 `01-draft-migrations.sql`、`02-draft-migrations.sql`。

| 项目 | 结果 |
|---|---|
| 两份草案按序应用，`ON_ERROR_STOP` | 通过 |
| 事实表（会话、动作执行、逐组、日志）哈希前后对比 | 一致 |
| 新分化键 `chest`、`cardio` 入库 | 通过；格式非法的键（如 `Bad Key`）被拒绝 |
| `next_program_day` 对 1.2 的 8 种账本状态 | 0 处不一致 |
| `workout_log_type_for_split` 对 push/pull/legs | 与旧 `case` 一致 |
| 私有方法可见性 | 所有者可见方法、release、2 个分化日；其他用户不可见；官方 1.2 对所有人可见 |
| 可选日 | 完成"胸"后 `next_program_day` 返回空，一轮可结束 |
| 账号删除（所有者持有激活的私有 release 与训练记录） | 全部清理，官方方法不受影响 |
| 直接删除激活的 release、其分化日、官方 1.2 | 均被阻止 |
| 调整层行级安全 | 用户只能读自己的 |

**局限**：数据只有少量种子，验证的是机制与结构；`complete_method_session_v3`、各 v2 函数、创建私有方法函数尚未编写，对应测试在文档 6 中列出。

## 10. 对影响面台账的补充（并入文档 0 附录 A）

| 模块 | 新增影响 |
|---|---|
| 完成训练函数（v2→v3） | 必须基于 Patch B 合并后的最新定义 |
| 任何读取 `methods`、release 级表的接口 | 读取范围变化：私有方法只对所有者可见。官方方法的读取结果不变 |
| 账号删除流程 | 依赖 M13 对两个保护触发器的修改；纳入验收 |
| 方法文案（`lib/method-availability.ts`） | 不再写死"三分化""推" |
| 自由记录词表 | 补充"腹肌" |
| 日复盘证据与教练上下文（Patch B 之后） | 读取 `method_enrollments.next_split_key` 并用写死的三项映射转成名称；新方法会显示原始键。改为读方法数据（见第 8 节） |
| `/api/method/current/progress` | 读取三个旧列，新方法为空；改为按处方状态汇总 |

## 11. 待决事项

| 编号 | 问题 | 本文默认 |
|---|---|---|
| O-2 | 休息日如何建模 | 已决：`min_gap_days`，仅建议 |
| O-9 | 软删除后这一天是否可重做 | 默认不回退进度；如需回退，另做 `reopen_program_day` |
| O-11 | 哪些日子计入"一轮完成" | 默认仅力量日 `required = true`，核心、有氧为 `false`，导入审核页可改（待确认） |
| O-12 | 私有方法的器械门槛 | 默认不设 `full_gym` 门槛，由健康声明和用户自行判断（待确认） |
| O-13 | 每用户私有方法数量与导入频率上限 | 文档 5 定数值 |

## 12. 本文的验收标准

- 草案 SQL 在 Supabase 分支库演练通过，文档 1 的 V13 哈希前后一致。
- `complete_method_session_v3` 对 1.2 的黄金用例（既有 `tests/method-runtime/*`）全部通过，且新增四分法夹具能跑通"开始 → 记组 → 完成 → 下一天 → 整轮滚动 → 第 2 轮"。
- 私有方法的可见性、创建顺序、账号删除各有自动化测试（文档 6）。
