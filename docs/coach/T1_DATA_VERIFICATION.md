# T1 · 数据核实（patch 文档第 4 节 D1–D5）

依据：`docs/COACH_AI_PATCH_2026-09-27.md` 第 4 节列出的 SQL，加上 Sylvan 2026-09-27 的补充说明。**只查不改**——本文档不改代码，只记结论，需要 Sylvan 跑 SQL 的项目单独列出。

## 结论一览

| # | 结论 | 状态 |
|---|---|---|
| D1 | 19924 分钟那条记录的成因未知 | **待核实** — 需要 Sylvan 跑 SQL |
| D2 | 正常，不是 bug | **已核实**（Sylvan 2026-09-27） |
| D3 | `view_date`/`log_date` 不一致的原因未知 | **待核实** — 需要 Sylvan 跑 SQL |
| D4 | 09-25 不明来源写回的具体行未知 | **待核实** — 需要 Sylvan 跑 SQL |
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

**结论：待核实，需要 Sylvan 跑 SQL。**

页面已经不再把这类超范围时长显示给用户（T0 的 `lib/coach/session-duration.ts` 会把 5–150 分钟以外的值标记为"记录异常，未计入"），所以这不是一个用户可见的 bug；但它为什么会出现在数据里还不知道——如果是某种写入逻辑的问题，可能还会继续产生类似的异常记录，只是被前端过滤掉了而已。

需要请 Sylvan 在线上库跑一次：

```sql
select ws.id, ws.started_at, ws.completed_at, ws.duration_minutes, wl.duration_minutes as log_minutes,
       min(se.completed_at) as first_set, max(se.completed_at) as last_set
from workout_sessions ws
left join workout_logs wl on wl.method_workout_session_id = ws.id
left join set_executions se on se.workout_session_id = ws.id and se.status = 'completed'
where ws.duration_minutes > 150 or wl.duration_minutes > 150
group by ws.id, wl.duration_minutes;
```

结果贴回来后，看 `started_at`/`completed_at`/第一组和最后一组的时间差，应该能看出是"训练没点结束、隔了很久才关闭会话"这种正常但少见的情况，还是写入时的单位错误（比如秒当成了分钟）。

---

## D3 · `view_date` 09-13 和 `log_date` 09-24 不一致

**结论：待核实，需要 Sylvan 跑 SQL 或直接确认。**

原始报告没有给出具体的核实 SQL，只说了需要确认"补记旧日期"是正常情况还是日期写错了。需要 Sylvan：

1. 确认这条记录属于哪个功能路径——是用户在"补记"页面主动选了旧日期，还是某个自动生成逻辑写错了 `log_date`。
2. 如果是补记功能：这是设计内行为，不用改，只需要在 `docs/coach/HANDOFF.md` 或本文档里记一句"这是正常的补记路径"，避免以后又被当成 bug 查一遍。
3. 如果不是补记功能：需要贴一下这条记录的 `id`，方便下一个任务追查写入路径。

---

## D4 · 09-25 那次不明来源的写回

**结论：待核实，需要 Sylvan 跑 SQL。**

需要在 `workout_sessions`、`set_executions` 里按 `updated_at` 落在 09-25 的行做一次筛选：

```sql
select id, user_id, status, updated_at, created_at
from workout_sessions
where updated_at::date = '2026-09-25' and updated_at <> created_at
order by updated_at desc;

select id, user_id, workout_session_id, status, actual_reps, actual_weight_kg, updated_at, completed_at
from set_executions
where updated_at::date = '2026-09-25' and updated_at <> created_at
order by updated_at desc;
```

（`updated_at <> created_at` 是为了排除正常的首次写入，只看"后来又被改过"的行。）结果贴回来后能看出这是训练页保存流程的正常更新（比如用户回来改了一组的数据），还是某个后台任务/迁移脚本意外写回了旧数据。

---

## 补充发现（不在原 D1–D5 里，来自 Sylvan 2026-09-27 的附注）

**测试账号 969807db：推训练还没结束时，拉和腿两张处方就同时生成了。**

> 推测是在计划页往后翻触发的，不影响功能。

这个现象和 D2 的结论（`planned_for_date` 是"最早可以开始"而不是固定日历）是一致的：拉/腿的处方本来就可能提前生成，只是"提前多久生成"和"现在这张有没有练完"是两件独立的事。Sylvan 判断不影响功能，这次**不作为 bug 处理**，但记录下来供以后参考：

- 如果以后要做"下一次训练关键组"这类需要读取"下一张未开始处方"的功能（`lib/coach/workout-context.ts#loadNextSession` 已经有类似逻辑），要注意"下一张"可能不止一张处于 `upcoming`/`ready` 状态，取的时候要按 `split_key` 精确匹配（现有代码已经是这样做的：`session_prescriptions.split_key = enrollment.next_split_key`），不能假设"未开始的处方只有一张"。
- 如果之后想收紧成"同一时间只允许一张 upcoming 处方"，这是一个产品判断（要不要限制翻页触发生成），按 HANDOFF §8 应该先问 Sylvan，这次不擅自改。

---

## 下一步

D1、D3、D4 需要 Sylvan 跑上面的 SQL、把结果贴回来，才能给出最终结论和改法。D2、D5 已经有结论，不需要再做什么。
