# T1 · 数据核实（patch 文档第 4 节 D1–D5）

依据：`docs/COACH_AI_PATCH_2026-09-27.md` 第 4 节列出的 SQL，加上 Sylvan 2026-09-27 的补充说明。**只查不改**——本文档不改代码，只记结论，需要 Sylvan 跑 SQL 的项目单独列出。

## 结论一览

| # | 结论 | 状态 |
|---|---|---|
| D1 | 找到成因：一个 14 天前"点开始"但没做完的训练会话，被翻出来继续做，`duration_minutes` 按整段会话算，不是数据错误 | **已核实**（Sylvan 2026-09-27 提供 SQL 结果） |
| D2 | 正常，不是 bug | **已核实**（Sylvan 2026-09-27） |
| D3 | 正常：`view_date` 是"最早可以开始"，`log_date` 是实际训练日，间隔取决于用户节奏 | **已核实**（Sylvan 2026-09-27 提供 SQL 结果） |
| D4 | 找到成因：`20260925000200_training_date_navigation.sql` 迁移的一次性回填 UPDATE，不是可疑写回 | **已核实**（Sylvan 2026-09-27 提供 SQL 结果） |
| D5 | 不是 bug，`methods.version` 只是标签没同步 | **已核实**（patch 文档本身已给出结论，见下） |

补充一条不在原来 D1–D5 里、但同一批测试中发现的现象，见文末「补充发现」。

---

## D2 · `planned_for_date` 没有推进

**结论：正常，符合设计。**

Sylvan 2026-09-27 确认：

> `planned_for_date` = 上一练完成的日期，也就是"这一练从哪天起可以开始"，不是预先排定的日期；生成时间和上一练的完成时间精确一致，可以证明。

也就是说 `planned_for_date` 的语义是"最早可以开始训练的日期"，由上一次训练完成时写入，而不是像固定的"练三休一"日历那样提前排好。这和 METHOD_RULES 里 M009（"三分化不等于固定的练三休一"）一致，**不需要改代码**。

之前查不到结果是因为核实 SQL 里的 `<uid>` 填错了（不是 969807db，是另一个测试账号）。

**对后续开发的影响**：`lib/coach/prompts.ts`/`workout-context.ts` 里任何用到"下次训练是哪天"的文案，都应该按"从这天起可以开始"来表述，不能说成"计划在这天"，否则会暗示一个固定日历，和 M009 冲突。目前 `lib/evidence/daily-review.ts` 里的 `next_training` 只给出 `split_label`（推/拉/腿），没有日期，这一点是对的，不用改。

---

## D5 · Method 版本标记

**结论：不是 bug。** patch 文档第 4 节已经给出结论，这里复述一遍，不重复验证：

`methods.version` 是方法本身的版本号，`method_releases` 才是运行时实际读取的发布版本。`IMPLEMENTATION_STATUS.md` 说的"v1.2 已激活"指的是 release，`methods` 表那一行的版本标签只是没有同步，不影响功能。要不要把 `methods.version` 也改成 1.2 只是换个标签，属于 HANDOFF §7"等 Sylvan 决定的事"，不在这次核实范围内处理。

---

## D1 · 19924 分钟那条记录

**结论：已核实。找到成因，不是数据写入错误。**

SQL 结果（session `fe8c6cdc`）：

| 字段 | 值 |
|---|---|
| `started_at` | 2026-09-13 08:53:00 |
| `completed_at` | 2026-09-27 04:56:35 |
| `duration_minutes` | 19924 |
| `first_set`（第一组完成时间） | 2026-09-27 04:53:24 |
| `last_set`（最后一组完成时间） | 2026-09-27 04:56:02 |

关键在于 `first_set` 和 `last_set` 都在 09-27，相隔只有约 2.6 分钟；而 `started_at` 是 14 天前的 09-13。也就是说：这个训练会话在 09-13 被"点开始"，之后一直没有结束（也没有做任何一组），14 天后（09-27）用户翻回这个未完成的会话，很快做了几组、点了结束。`duration_minutes` 按"点开始 → 点结束"整段计算，所以变成了 19924 分钟。**不是单位错误或写入 bug，是"很久以前开始、后来才继续做完"的真实会话。**

这正是 T0 已经做的修复要解决的问题：T0 把训练时长的默认口径从"点开始 → 点结束"（`session_span`）换成了"第一组完成 → 最后一组完成"（`set_span`，`lib/coach/session-duration.ts`），如果用这个口径算这次会话，时长会是约 3 分钟——虽然仍然会因为不到 5 分钟被判定为"记录异常，未计入"（`DURATION_MIN_MINUTES = 5`），但不会再出现 19924 这种荒谬数字。**这条数据反过来印证了 T0 那个修复方向是对的。**

**留给 Sylvan 的产品问题（不是这次数据核实要解决的，按 HANDOFF §8 不擅自定）**：一个训练会话可以在"点开始"14 天后还被翻出来继续、算作同一次训练，这是不是符合预期？如果不符合预期，可能需要给"未完成的会话"加一个过期时间，超过就提示用户重新开始一次新的训练，而不是继续这个很旧的会话。这次没有改动任何训练会话的开始/续做逻辑。

---

## D3 · `view_date` 09-13 和 `log_date` 09-24 不一致

**结论：已核实。正常，符合设计，不是补记功能，也不是写错。**

SQL 结果（补的核实查询）返回两条，两条 `execution_mode` 都是 `canonical`（不是"补充训练"的 `supplemental`，也不是`replay`）：

| id | view_date | log_date | performed_at / started_at / completed_at |
|---|---|---|---|
| `d16075bb…` | 09-13 | 09-24 | 全部是 09-24（03:02–03:35，正常一次约 33 分钟的训练） |
| `7abadee5…` | 09-11 | 09-12 | performed_at/started_at 09-12，completed_at 09-13 07:22 |

两条都是**同一次真实训练，`started_at` 到 `completed_at` 之间没有异常间隔**（不是 D1 那种"很久以前点开始"的情况）。差异出在 `view_date` 本身：`view_date` 是 `20260925000200_training_date_navigation.sql` 迁移给已有的旧会话做的一次性回填，回填值取的是 `session_prescriptions.planned_for_date`（回填语句：`view_date = coalesce(prescription.planned_for_date, session.log_date)`）。

结合 D2 已经确认的结论——`planned_for_date` 是"这一练从哪天起可以开始"（上一练完成的日期），不是固定日历——这两条记录的意思就是：

- `d16075bb…`：上一练在 09-13 完成，这一练"解锁"了，但用户隔了 11 天，到 09-24 才真正去做。
- `7abadee5…`：上一练在 09-11 完成，隔了 1 天，09-12 就做了这一练。

**`view_date` = 这一练最早可以开始的日期，`log_date` = 用户实际训练的日期，两者之间的间隔就是"解锁后隔了多久才去练"，间隔多长完全取决于用户自己的节奏，不是 bug，也不是补记功能——补记功能对应的是 `execution_mode = supplemental`，这两条都不是。** 迁移本身的字段注释也印证了这一点：`view_date` "从不决定训练历史的归属"，`log_date` 才是"历史/统计用的日期"。

不需要改代码，也不需要在这两个字段的语义上做任何调整。

---

## D4 · 09-25 那次不明来源的写回

**结论：已核实。是迁移脚本的一次性回填，不是可疑写回。**

SQL 结果：同一个 `user_id`（`8a2b06da…`）名下 4 行 `workout_sessions`，`created_at` 分布在 09-12 到 09-24 之间（横跨好几天，不是同一次训练产生的），但 **`updated_at` 全部是同一个时间点：2026-09-25 08:58:23.988119+00，精确到微秒都一样**。一个用户在同一微秒"手动"改了 4 场不同日期的训练记录是不可能的，这个特征就是一次批量 UPDATE 的指纹。

对照仓库找到了源头：`supabase/migrations/20260925000200_training_date_navigation.sql` 里有一条没有 `where` 限定范围的全表回填：

```sql
update public.workout_sessions
set view_date = coalesce(view_date, log_date),
    performed_at = coalesce(performed_at, started_at, created_at),
    performed_time_zone = coalesce(performed_time_zone, 'UTC'),
    execution_mode = coalesce(execution_mode, 'canonical');
```

这条迁移给 `workout_sessions` 新增了 `view_date`/`performed_at`/`performed_time_zone`/`execution_mode` 几个列，然后对**表里所有已有的行**做了一次回填（前面还有一条带 `where` 的回填，这条是兜底，把前一条没覆盖到的行也填上）。`workout_sessions` 表上有 `workout_sessions_set_updated_at` 触发器（`20260911000200_method_workout_runtime.sql`），任何 `UPDATE` 都会把 `updated_at` 设成 `now()`——迁移在 09-25 部署时跑了这条语句，全表所有行的 `updated_at` 就在同一微秒被改写成了迁移执行的那一刻。**这是预期中的迁移行为，不是数据问题，不需要改代码。**

如果以后再遇到"一批不同日期创建的行，`updated_at` 却精确相同"，可以直接按这个模式判断：先查有没有同一天部署的、对该表做无 `where` 回填的迁移，通常就是答案，不用怀疑到应用层的写入逻辑。

---

## 补充发现（不在原 D1–D5 里，来自 Sylvan 2026-09-27 的附注）

**测试账号 969807db：推训练还没结束时，拉和腿两张处方就同时生成了。**

> 推测是在计划页往后翻触发的，不影响功能。

这个现象和 D2 的结论（`planned_for_date` 是"最早可以开始"而不是固定日历）是一致的：拉/腿的处方本来就可能提前生成，只是"提前多久生成"和"现在这张有没有练完"是两件独立的事。Sylvan 判断不影响功能，这次**不作为 bug 处理**，但记录下来供以后参考：

- 如果以后要做"下一次训练关键组"这类需要读取"下一张未开始处方"的功能（`lib/coach/workout-context.ts#loadNextSession` 已经有类似逻辑），要注意"下一张"可能不止一张处于 `upcoming`/`ready` 状态，取的时候要按 `split_key` 精确匹配（现有代码已经是这样做的：`session_prescriptions.split_key = enrollment.next_split_key`），不能假设"未开始的处方只有一张"。
- 如果之后想收紧成"同一时间只允许一张 upcoming 处方"，这是一个产品判断（要不要限制翻页触发生成），按 HANDOFF §8 应该先问 Sylvan，这次不擅自改。

---

## 下一步

D1–D5 全部有结论，**T1 完成**。没有一项需要改代码；D1 留了一个产品问题给 Sylvan 决定（不阻塞其它开发，见上）。
