# 方法论导入大更新 · 文档 3：导入管线与金标集

- 状态：草案 v0.1
- 日期：2026-10-03
- 前置：文档 0（总纲）、1（数据架构）、2（方法数据模型）。本文落实原则 P1、P3、P4、P8、决策 D-1、D-2、D-6。
- 配套文件
  - `sql/03-draft-migrations.sql`：金标表、导入记录、动作对齐函数（草案，不是迁移）
  - `fixtures/quantity-cases.json`：22 条真实写法与期望解析结果
  - `fixtures/quantity-parser.prototype.mts`：已通过全部 22 条的参考原型（不是生产代码）

## 0. 关卡记录（G1–G4）

**G1 检索**：读取了 `lib/ai-client.ts`（`callStructuredOutput`、超时与模型配置）、T2 输出检查（`lib/evidence/output-checks.ts`，Patch B 链）、T3 生成日志（`lib/ai/generation-log.ts`、`ai_generations` 迁移，Patch B 链）、`method_source_documents` 的类型约束、`netlify.toml`、`proxy.ts`、workout-guide 的 302 条清单、用户提供的四篇文章。

**G2 审核**

| 类别 | 内容 |
|---|---|
| 已核实（读到代码） | `callStructuredOutput` 是通用的严格 JSON schema 调用，只有文本输入、没有图片和工具；模型由 `OPENAI_MODEL` 决定；超时默认 20 秒、上限 60 秒；仓库里只有一处按用户的限流：`app/api/ai/plans/route.ts:48-58`（统计近 1 小时本人 `ai_plans` 行数，超过 5 个返回 429，另限制输入 16KB），其他路由没有；`netlify.toml` 没有配置函数时限；`ai_generations.surface` 只允许 6 个值 |
| 已实测（本地） | 动作对齐函数、导入表、配额触发器、金标表权限（见第 9 节）；数量解析原型对 22 条真实写法 22/22 通过 |
| 已度量 | 四篇文章里出现的 36 个动作，关键词匹配可在 302 个动作库里全部找到候选（35 个首轮命中，1 个因我的正则漏写，核对后在库内为 `Dumbbell Fly`）。其中多个动作有多个候选（例如"哑铃肩推"对应 Overhead Press / Dumbbell Seated Shoulder Press / Machine Shoulder Press），不能直接判定 |
| 未核实 | Netlify 同步函数的实际超时（取决于套餐与配置）；所用 OpenAI 账号是否支持 web search 工具；严格 schema 在本文 schema 上的 token 用量与耗时（需在真实调用中测） |

**G3 影响面**：见第 11 节。
**G4 冲突**：依赖 Patch B 的 T3（`ai_generations`）合并后才能把抽取调用记入生成日志；其余部分独立，不改 `lib/ai-client.ts` 的现有导出。

## 1. 目标与边界

- 输入：用户粘贴的一段文字（决策 D-2）。链接抓取、截图、视频字幕不在本次范围。
- 输出：一份通过校验的 manifest（文档 2 第 3 节）和一份"待确认清单"。用户确认后，由 `create_private_method_v1` 写成私有方法。
- 官方方法使用同一条管线，只是由内部账号运行、写入时 `owner_user_id` 为空（需要独立的官方发布入口，不在本文范围）。
- 已有的 Excel 工作簿路径（`scripts/method-import`）继续用于编辑级导入，其输出改为同一份 manifest。

## 2. 设计原则

1. **模型不输出任何数字。** 模型只摘出"原文里的短语"（如"每组8至10次，做3组，组间休息60秒"）。数字由确定性代码从短语里解析。这从构造上消除了数字幻觉，也让数量解析可以被完整测试。
2. **每个值都带原文引用。** 引用必须能在（规范化后的）原文里找到，找不到就降级为"AI 推断"或丢弃。
3. **原文 > 金标 > AI 推断**（P3）。AI 推断的值一律需要用户确认才生效。
4. **每次请求只调用一次模型。** AI 客户端默认超时 20 秒，Netlify 同步函数也有时限，因此一次导入拆成多次请求，由客户端按步骤串起来，每一步把进度存进 `user_method_imports.manifest_draft`，可断点续做，也自然支持进度提示（"正在识别周四……"）。
5. **粘贴的文字是数据，不是指令。**

## 3. 管线总览

```
S0 同意      勾选健康声明（版本号入库）
S1 入库      user_method_imports：原文、校验和、同意记录；配额检查
S2 预处理    规范化文本，切成带偏移量的段落表        （确定性）
S3 提纲      模型一次调用：是不是训练计划？有几天？有几套方案？     ← 模型调用 1
S4 逐日抽取  每个训练日一次调用：动作、短语、替换动作、要点          ← 模型调用 2…N+1
S5 解析校验  短语 → 数字；引用必须在原文中；范围与单位规整        （确定性）
S6 动作对齐  名称 → 动作身份：精确/别名/候选/新建草稿               （确定性 + 可选一次模型排序）
S7 补缺省    原文没写的字段，用已审核的金标默认值补               （确定性）
S8 搜索补全  仍缺失的内容，联网搜索，结果为 AI 推断                  （可选，默认关闭）
S9 安全检查  数量上限、风险提示、方案冲突                             （确定性）
S10 审核     摘要卡 + 待确认清单（文档 4）
S11 发布     create_private_method_v1（文档 2）→ 可选直接报名
```

**每一步的状态**都写入 `manifest_draft`，`status` 依次为 `draft → extracting → review → published`，失败为 `failed`，用户放弃为 `discarded`。客户端不能把状态设为 `published`（已实测：该更新被行级安全拒绝）。

## 4. 抽取 schema（面向模型，扁平）

OpenAI 严格模式要求：所有属性都在 `required` 里，可选项用"可空"表达，且 `additionalProperties: false`。模型面向的 schema 因此保持扁平，由确定性代码装配成文档 2 的 manifest。

**S3 提纲**
```ts
{
  looks_like_training_plan: boolean,     // 营养文章、闲聊等直接终止
  reason: string,
  method_name: string | null,
  level_hint: 'beginner' | 'intermediate' | 'advanced' | null,
  variants: Array<{ label: string, section_quote: string }>,     // 如 "三分化" / "四分化"
  days: Array<{
    name_zh: string,                     // 如 "肩"
    day_type: 'strength' | 'core' | 'cardio',
    variant_label: string | null,
    section_quote: string                // 该日第一句原文，用于在原文里定位起点
  }>,
  open_questions: Array<{ question: string, quote: string | null }>
}
```

**S4 逐日抽取**（只收到该日对应的原文片段）
```ts
{
  exercises: Array<{
    name: string,                        // 原文里的名称
    quote: string,                       // 该动作整段原文
    role_hint: 'primary' | 'secondary' | 'accessory' | 'isolation' | null,
    sets_phrase: string | null,          // "做3组" / "进行 3 - 4 组" / "每组力竭"，逐字摘录
    reps_phrase: string | null,
    rest_phrase: string | null,          // 组间休息
    rest_between_exercises_phrase: string | null,
    duration_phrase: string | null,
    distance_phrase: string | null,
    failure_phrase: string | null,
    per_side_phrase: string | null,
    equipment_hint: string | null,       // 如 "哑铃"、"绳索"
    variant_label: string | null,        // 仅在某套方案里出现，如"四分化推荐加入面拉"
    alternatives: Array<{ name: string, quote: string }>,
    cues: Array<{ text: string, quote: string }>
  }>,
  warmup_notes: Array<{ text: string, quote: string }>,
  cooldown_notes: Array<{ text: string, quote: string }>
}
```

## 5. 确定性解析与校验（S2、S5）

### 5.1 文本规范化
全角数字转半角；`至`、`到`、`－`、`—`、`~`、`～` 统一为 `-`；去掉空白；中文数字（一至九十九）转阿拉伯数字。规范化只用于匹配，界面高亮仍用原始偏移量。

### 5.2 数量解析（已有原型，22/22）
覆盖的写法（均来自四篇文章）：
- 组数：`做3组`、`进行 3 - 4 组`、`做2至3组`、`4 组，每组…`、`五组`
- 次数：`每组8至10次`、`每组 12 - 16 次`、`每组 5 次`
- 休息：`组间休息60秒`、`（组间休息 1 -2分钟）`
- 时间：`30s`、`15min`、`5 - 10 分钟`
- 力竭：`每组力竭`
- 每侧：`左右腿各进行`、`每侧`

**组数是范围**（如"做 2 至 3 组"）：写成"必做 2 组 + 1 组可选"，对应文档 2 的 `optional`。

**两种休息必须分开**：`每个动作之间休息 4-6 分钟，组间休息 2-3 分钟` 里，4–6 分钟是动作间休息，2–3 分钟才是组间休息。原型第一版把前者当成了组间休息，我在核对时发现预期值本身写错了并更正，所以这一条是必须保留的测试用例。

**尚未覆盖，需要补用例**：`先高后低`（12/10/8 递减）、`10+10`（休息-暂停）、`每周增加 5%-10%`（递进，只记为备注，不进处方）、表格式写法、英文写法。

### 5.3 校验规则

| 规则 | 内容 | 失败时 |
|---|---|---|
| R1 | 每个引用必须能在规范化后的原文中找到 | 该字段丢弃，动作保留并记入待确认 |
| R2 | 解析出的数字必须出现在对应短语里 | 同上 |
| R3 | 范围合理：次数 1–100、组数 1–12、单次休息 ≤ 10 分钟、时长 ≤ 2 小时 | 标记待确认，不入库 |
| R4 | 每天 ≤ 12 个动作；每天总组数 ≤ 40；总天数 ≤ 14 | 超出则截断并提示 |
| R5 | 名称长度 1–40 字；同一天内同名动作合并 | 合并并提示 |
| R6 | 提纲里 `looks_like_training_plan = false` | 终止，提示"没找到训练计划" |
| R7 | 记录形态与数据一致：时长型动作不应出现次数，次数型不应出现距离 | 标记待确认 |
| R8 | 多套方案（variants）未选择就不得进入 S4 | 摘要卡要求选择 |
| R9 | 引用内容含"忽略以上指令""系统提示"等指令样文本 | 丢弃该引用，计入日志 |
| R10 | 标为 `method_explicit` 却没有有效引用 | 直接拒绝，视为程序错误 |

## 6. 动作对齐与补缺省（S6、S7）

**对齐顺序**
1. **确定性**：调用 `resolve_or_create_exercise` 的前两步逻辑——名称或别名与已审核动作（去空格、标点、忽略大小写）一致，则 `match = 'exact'`（名称）或 `'alias'`（别名）。已实测。
2. **候选**：未命中时，代码在动作库（中文名、别名、英文名）里按词重叠取前 8 个候选；模型只能在这 8 个里选一个，或回答"都不是"。选中的标为 `candidate`，必须进入用户待确认。
3. **新建**：都不是则调用 `resolve_or_create_exercise` 创建本人草稿（已实测：同一用户重复调用返回同一条；他人的同名草稿不被复用，会创建带后缀的新草稿；每人最多 100 个草稿）。

**歧义规则**：同一基础名称在库里有多个器械变体，而原文没有器械线索时，一律标 `candidate`，不得标 `exact`。例如"哑铃肩推"同时有 Overhead Press、Dumbbell Seated Shoulder Press、Machine Shoulder Press 等候选。

**补缺省**：原文没写的字段，按下面的顺序补，并写明来源标签：
- 金标 `exercise_defaults` 中 `review_status = 'reviewed'` 的行 → `library_default`
- 金标中仍是 `draft` 的行 → `ai_inferred`（显示为建议值，需确认）
- 都没有 → 保持空，进入待确认

补缺省的**水平**取 manifest 的 `level`，缺省为 `beginner`。

## 7. 金标集

### 7.1 内容与结构

| 内容 | 位置 | 说明 |
|---|---|---|
| 动作身份 | 现有 `exercises` | 增加 `review_status`、`record_shape`、`created_by`（文档 1）、`risk_flags`（本文），已有 `aliases`、`canonical_name_en` |
| 默认值 | `exercise_defaults` | 每个动作、每个水平一行：组数、次数、休息、时长、距离、力竭策略 |
| 替换关系 | `exercise_substitutions` | `swap` / `regression` / `progression` |
| 动作要点 | `exercise_cues` | 准备、发力、呼吸、常见错误、安全 |
| 外部素材映射 | 现有 `exercise_external_mappings` | 沿用，`candidate` / `confirmed` |
| 方案金标 | `docs/method-import/gold/plans/*.json`（待建） | 人工核对过的完整方案，作评测的标准答案和提示示例 |

三张新表都是参考数据：登录用户可读，客户端没有写权限（已实测：读取为 0 行、插入被拒）。

### 7.2 种子来源：workout-guide 的 302 个动作

| 记录形态（来自 `exerciseType`） | 数量 |
|---|---|
| `weight_reps` | 136 |
| `bodyweight_reps` | 114 |
| `duration` | 39 |
| `distance_duration` | 10 |
| `assisted_bodyweight` | 3 |

- 其中 14 个是拉伸类，13 个器械为有氧。**有氧、腹肌、拉伸的动作库已经覆盖**，不需要另建来源。
- 现有 15 个动作里，已核实的 11 个映射 slug 全部在 302 条之内，这 11 条继续沿用现有行，不重建。
- 其余约 290 条新增为 `exercises` 行：英文名取库中的 `name`，中文名由 AI 生成，再由你审核。

### 7.3 种子流程（编辑级，一次性）

1. 脚本 `scripts/method-import/seed-library.mts` 读取 302 条清单，让模型生成：中文标准名、别名（含常见叫法）、目标部位、风险标记、三个水平的默认值、替换动作、要点。输出为**审核表（CSV）**，不写数据库。
2. 脚本自动检查：中文名在全表内是否重复、别名是否撞车、同一英文名是否对应多个中文名，并把冲突行标红。
3. 你在表格里按行打勾通过；优先审核约 60 个最常用的（四篇文章里的动作加 1.2 的动作）。
4. 通过的行生成一份**增量种子迁移**（`insert … on conflict do nothing`，`review_status = 'reviewed'`）；未通过的保持草稿，仍可用于名称对齐，但它们的数字只作建议显示。
5. 外部素材映射用现有 `exercise_external_mappings`，每条 302 个 slug 一行（`candidate`，审核后升级为 `confirmed`）。

**为什么先用表格审核**：成本最低，不需要先做审核页面；金标是内部数据，不对用户展示。

### 7.4 AI 生成金标的循环论证风险
金标由 AI 生成，再由 AI 在导入时引用，等于自己给自己当答案。缓解办法已写入规则：只有 `reviewed` 的行才能把数字当作 `library_default` 自动补入；`draft` 行只能用来对齐名称，数字显示为"AI 建议"。

## 8. AI 搜索补全（S8）

- **默认关闭**，由开关控制，只在 S7 之后仍缺失的内容上触发。
- 结果一律 `ai_inferred`，附来源链接，永不覆盖原文或金标，永不自动生效。
- 每次导入最多 3 次搜索，失败则静默跳过。
- **未核实**：当前 OpenAI 账号与模型是否支持 web search 工具；`callStructuredOutput` 目前不带工具参数。上线前需要先做一个独立的可行性验证。

## 9. 数据库草案与实测

`sql/03-draft-migrations.sql`，在全新回放库上与 01、02 草案一起应用，事实表哈希前后一致。

| 项目 | 结果 |
|---|---|
| 精确名称命中已审核动作 | 通过 |
| 别名命中（名称中间带空格） | 通过 |
| 同一用户同名重复调用 | 返回同一条草稿 |
| 他人同名草稿 | 不复用，创建带后缀的新草稿（如"哑铃肩推 · 9162"） |
| 草稿可见性 | 创建者可见，他人不可见，已审核动作对所有人可见 |
| 名称为空、超过 40 字 | 被拒绝 |
| 没有同意记录创建导入 | 被拒绝（非空约束） |
| 24 小时内第 6 条导入 | 被拒绝（配额触发器，数值 5 为建议值） |
| 其他用户读取我的导入 | 看不到 |
| 客户端把状态改为 `published` | 被拒绝；改为 `review` 可以 |
| 客户端写入金标表 | 被拒绝；读取可以 |

## 10. 安全、隐私与成本

| 风险 | 措施 |
|---|---|
| 提示注入（原文里夹带指令） | 原文始终作为数据传入；抽取阶段不给模型任何工具；输出受严格 schema 约束；引用校验会丢弃注入内容；R9 |
| 原文含个人信息 | 原文只存在 `user_method_imports.raw_text`；发布后设置 `raw_text_purge_after`，到期清空原文，只保留校验和（清除作业需单独实现，本草案未含） |
| 滥用与成本 | 每用户 24 小时 5 条导入（数据库触发器强制，另在接口层沿用 `ai/plans` 路由的"统计近期行数 → 429"写法给出友好提示）；原文 ≤ 30000 字；每次调用设置 token 上限；失败即停，不自动重试超过 1 次 |
| 非训练内容 | S3 的 `looks_like_training_plan` 为 false 即终止 |
| 过量方案 | R3、R4 的上限；风险标记只提示，不拦截 |
| 生成日志 | 每次调用记入 `ai_generations`（依赖 T3 合并，并把 `surface` 约束加入 `method_import`）；该表的保留期为 90 天 |
| 同意 | 导入必须带同意版本与时间，数据库层面保证（非空约束） |

## 11. 对影响面台账的补充（并入文档 0 附录 A）

| 模块 | 新增影响 |
|---|---|
| `lib/ai-client.ts` | 不改现有导出；新增调用方传入更大的 `maxOutputTokens`；如需不同超时，需新增参数 |
| 生成日志与评测 | 依赖 Patch B 的 T3；新增 `method_import` surface |
| 动作选择与展示 | 动作库从 15 增至约 300；展示处需处理"草稿动作只对创建者可见" |
| 媒体 | 新增 mapping 行；缺素材的动作降级为文字（现有行为） |
| 部署 | 每次请求只做一次模型调用，避免触及 Netlify 同步时限 |

## 12. 代码模块与接口（车道 B）

```
lib/contracts/method/manifest.ts              文档 2 的 zod schema
lib/method-import/normalize-text.ts           规范化、段落表
lib/method-import/parse-quantities.ts         数量解析（以 fixtures 为测试）
lib/method-import/extract-schema.ts           S3、S4 的 JSON schema 与类型守卫
lib/method-import/extractor.ts                封装 callStructuredOutput，每次一步
lib/method-import/verify.ts                   R1–R10
lib/method-import/align-exercises.ts          S6
lib/method-import/fill-defaults.ts            S7
lib/method-import/safety-checks.ts            S9
lib/method-import/build-manifest.ts           装配 manifest
app/api/method-import/route.ts                POST 创建导入（必须带同意）
app/api/method-import/[id]/extract/route.ts   POST 执行一步（outline / day），幂等
app/api/method-import/[id]/route.ts           GET 草稿、PATCH 用户修改（服务端重新校验）
app/api/method-import/[id]/publish/route.ts   POST 发布并可选报名
scripts/method-import/seed-library.mts        金标种子
scripts/method-import/eval.mts                评测
```

## 13. 评测

| 指标 | 含义 | 门槛 |
|---|---|---|
| M1 数字可追溯率 | 解析出的每个数字都出现在引用里，引用都在原文中 | **100%（硬门槛）** |
| M2 幻觉数 | 标为 `method_explicit` 却无有效引用的值 | **0（硬门槛）** |
| M3 空缺标注率 | 原文没有的字段，必须为空或 `ai_inferred`，不得为 `method_explicit` | **100%（硬门槛）** |
| M4 动作对齐 | `exact` 的准确率 ≥ 98%；有歧义的必须是 `candidate` | 硬门槛 |
| M5 结构正确率 | 天数、顺序、日类型与金标一致 | ≥ 95% |
| M6 召回 | 原文里的动作被抽出的比例 | ≥ 95% |

- **夹具**：四篇文章（肩、背、腿、胸），加上 `fixtures/quantity-cases.json` 的 22 条，加上对抗用例（提示注入文本、非训练文章、营养文章、很长的文本、表格、英文计划、同一文章里两套方案）。
- **运行**：`scripts/method-import/eval.mts` 离线运行，按"原文校验和 + 提示版本 + 模型"缓存；报告写出所用模型与提示版本。
- **何时跑**：修改提示、schema、解析器或更换模型后必须重跑；M1–M4 任一不达标，不允许上线。
- **标准答案**：先由我整理，再由你审核，作为方案金标的第一批。

## 14. 待决事项

| 编号 | 问题 | 本文默认 |
|---|---|---|
| O-13 | 每用户配额数值 | 导入 5 条 / 24 小时（已在草案中），私有方法上限 10 个（文档 2 中创建函数里检查） |
| O-14 | 一篇文章含多套方案时 | 必须由用户选择一套（预选内容更完整的一套）；要导入另一套就再导入一次 |
| O-15 | 搜索补全是否上线 | 默认关闭，先验证可行性（第 8 节） |
| O-16 | 原文保留期 | 发布后 30 天清空原文（待确认） |
| O-17 | 是否在导入时让用户选择水平 | 默认取 manifest 的 `level`，缺省 `beginner` |

## 15. 本文的验收标准

- `fixtures/quantity-cases.json` 的 22 条全部通过，并补齐第 5.2 节"尚未覆盖"的写法。
- 评测的 M1–M4 在四篇文章和对抗用例上全部达标。
- 同一段原文在同一模型、同一提示版本下重复导入，结果经校验后一致（结构级别，不要求逐字）。
- 从粘贴到出现摘要卡的端到端流程，在真实调用下每一步都小于 AI 客户端超时。
