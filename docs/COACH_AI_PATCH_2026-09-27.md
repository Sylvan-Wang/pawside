# Coach AI Patch · 2026-09-27

分支：`coach-ai-patch-2026-09-27`。范围：训练反馈、餐后反馈、今日复盘三个 AI 出口，加上训练页、饮食页里直接影响这三个出口的问题。

依据：Sylvan 与 Claude 的评审文档（Prompt 草稿 v2）、DSH 的 `REAL_DATA_VERIFICATION_REPORT`、仓库 `master@eb9ab2a`。

---

## 1. 改了什么

| # | 问题（实测看到的） | 改法 | 文件 |
|---|---|---|---|
| 1 | 训练报告“没有训练感”，只复述组数和时长 | 训练反馈 prompt v2：按动作写，讲关键组（末组 10+5、休息-暂停组）、处方与实际的差别、和上次比的变化，并给出下次训练的一个关键组 | `lib/coach/prompts.ts`、`lib/coach/workout-context.ts`、`app/api/ai/compose/route.ts` |
| 2 | 每一组看起来都一样，方法论细节没有体现 | 训练页每一组显示组类型和目标（热身组 · 15 次 · 轻松完成；第 4 组 · 休息-暂停组 · 目标 10 + 5 次 · 做到接近或到力竭）。数据本来就在 `set_prescriptions` 里，之前只是没渲染 | `lib/coach/set-guidance.ts`、`app/training/sessions/[sessionId]/page.tsx` |
| 3 | 填了没点“完成这一组”就离开，数字丢失 | 未保存的输入按“用户 + 训练 + 动作 + 组”存在本机，回来时恢复，并标出“已恢复未保存的输入”。**不会自动提交**：一组算不算完成，仍由用户点按钮决定 | `lib/training-draft-store.ts`、训练页 |
| 4 | 可乐鸡翅没算进“本餐” | 餐后反馈把同一天、同一餐别的所有保存合并成“这一餐”再判断 | `lib/coach/meal-context.ts`、compose 路由、饮食页传 `meal_type` |
| 5 | 餐的参考范围口径 | 只用现有 `guidance.ts` 的范围（早 25–30%、午 30–40%、晚 30–35%），加餐没有范围。替代规格里的 D21 | `lib/coach/meal-context.ts` |
| 6 | 改了食物名，营养数值还是上一个食物的 | 改名时清掉来自上一个食物的数值；只有用户手填的数值会保留 | `app/food/FoodPageClient.tsx` |
| 7 | 输入框里出现 20.480000000000004 | 由每 100g 数据算出的数值只在显示时取整（热量取整数，三大营养素保留 1 位）。保存时仍然传 per100g，存储保持精确 | 饮食页 |
| 8 | 营养输入框用占位文字当标签，填了数值以后看不出是哪一项 | 每个框上方都有常驻的文字标签 | 饮食页 |
| 9 | 日报一直在说数据完整性 | 日报 prompt v2：优先级改成 营养 > 训练 > 恢复 > 身体，数据完整性只在 `data_quality_tip` 里说一次；休息日不催训练（M009） | `lib/coach/prompts.ts`、两个 daily review 路由 |
| 10 | 规则卡片和 AI 文字重复同一件事 | 有 AI 文字时不再显示规则卡片；没有 AI 时，规则卡片作为“基础总结”显示 | 训练页、饮食页 |
| 11 | 用户看到 “依据：AI Patch §8”、“partial” | 依据改成平实标签（Pawside 规则 / 训练方法 / 公开指南）；模型输出里出现内部用语会被拦下，重试一次，仍不合格则回退到基础总结 | `lib/coach/display.ts`、`lib/evidence/composer.ts` |
| 12 | 标题被截断 | 标题要求 ≤30 字；超了重试一次，仍超就接受，不截断 | composer |
| 13 | 19924 分钟这类时长进入报告 | 时长在 5–150 分钟以外就不当作训练事实交给模型，页面显示“记录异常，未计入” | `lib/coach/session-duration.ts`、session-feedback 路由、daily review |

## 2. 还没定、先按默认走的（都能用开关撤回）

| 事项 | 当前默认 | 如果不对，怎么切 |
|---|---|---|
| 训练时长怎么算 | 第一组完成 → 最后一组完成（`set_span`）；不到两组时退回“点开始 → 点结束”；再退回数据库存的分钟数 | Netlify 环境变量 `PAWSIDE_COACH_DURATION_BASIS=session_span` |
| 新 prompt 整体 | 开 | `PAWSIDE_COACH_PROMPT_V2=0`，恢复旧的一句话指令 |
| 训练反馈读 Method 处方与实际 | 开 | `PAWSIDE_COACH_METHOD_CONTEXT=0` |
| 餐后按整餐合并 | 开 | `PAWSIDE_COACH_MEAL_CONTEXT=0` |
| 内部用语拦截与重试 | 开（会多一次模型调用，内测只有 2 个用户，可以接受） | `PAWSIDE_COACH_OUTPUT_GUARD=0` |

## 3. 数据不确定性：代码怎么兜底

这次 patch 依据的是导出数据和仓库代码，没有直接读线上库（Supabase 项目当时是 INACTIVE）。所以每一处都按“字段可能不在、可能为空”来写：

- **Method 上下文加载**（`loadMethodWorkoutContext`）：任何一次查询失败，或者关联不存在，都返回 `null`，训练反馈退回旧行为（只看 facts）。下一次训练的处方还没生成，不算错误，`key_sets` 为空。
- **组的数值目标**：导出里 `target_rpe / target_rir / target_weight_kg / rest_*` 全是 null。页面只显示有值的部分，不会补默认值。等 importer 写入这些值（比如卧推 RIR 2），页面和 prompt 会自动显示“保留 2 次余力”。
- **内部备注**：像“运行时默认；不得表述为作者原始处方”这类备注会被过滤，只留下对用户有意义的部分（“每侧”）。
- **数字校验**：模型只能引用 facts 里的数字，以及规则产生的计划数字（10、5、组号等）；出现其他数字仍然整条拒绝。
- **草稿恢复**：48 小时后失效；浏览器禁用存储时静默跳过。
- **旧客户端**：`meal_type` 是可选参数，不传就走原来的全天判断。

## 4. 这个 patch 没做、需要 DSH 先核实的

下面这些是数据问题，不能凭导出去改代码。每条附了核实用的 SQL，结果贴回来就能决定改法。

**D1 · 19924 分钟那条记录。** 页面已经不再显示这个数字，但它为什么会出现还不知道。

```sql
select ws.id, ws.started_at, ws.completed_at, ws.duration_minutes, wl.duration_minutes as log_minutes,
       min(se.completed_at) as first_set, max(se.completed_at) as last_set
from workout_sessions ws
left join workout_logs wl on wl.method_workout_session_id = ws.id
left join set_executions se on se.workout_session_id = ws.id and se.status = 'completed'
where ws.duration_minutes > 150 or wl.duration_minutes > 150
group by ws.id, wl.duration_minutes;
```

**D2 · `planned_for_date` 没有推进。** 先确认它是设计上允许为空（M009：三分化不是固定的练三休一），还是漏写了。

```sql
select split_key, status, planned_for_date, generated_at from session_prescriptions
where user_id = '<uid>' order by generated_at desc limit 10;
```

**D3 · `view_date` 09-13 和 `log_date` 09-24 不一致。** 需要确认是“补记旧日期”的正常情况，还是日期写错了。

```sql
select id, split_key, execution_mode, view_date, log_date, performed_at, started_at, completed_at
from workout_sessions where view_date <> log_date order by started_at desc;
```

**D4 · 09-25 那次不明来源的写回。** 需要在 `workout_sessions`、`set_executions` 的 `updated_at` 里找出 09-25 被改过的行。

```sql
select 'workout_sessions' as t, id, updated_at from workout_sessions
  where (updated_at at time zone 'Asia/Shanghai')::date = '2026-09-25'
union all
select 'exercise_executions', id, updated_at from exercise_executions
  where (updated_at at time zone 'Asia/Shanghai')::date = '2026-09-25'
union all
select 'set_executions', id, updated_at from set_executions
  where (updated_at at time zone 'Asia/Shanghai')::date = '2026-09-25'
order by updated_at;
```

**D5 · Method 版本标记。** `IMPLEMENTATION_STATUS.md` 写的是 v1.2 已按 `internal_beta / v1_runtime` 激活；DSH 报告说 `methods` 表那一行还是 draft / 1.0。两者可能都对（一个是 release 表，一个是 method 表）。

```sql
select id, key, version, status from methods;
select id, method_id, version, status, release_channel, release_policy from method_releases order by version desc;
```

从表结构看，这很可能不是 bug：`methods.version` 是方法本身的版本，`method_releases` 才是运行时实际使用的发布版本。所以运行时用 1.2 是对的，`methods` 那一行只是标签没有同步。patch 没有改这一行，因为改它只是换个标签，要不要改由你决定。

**D6 · 组的数值目标（RPE / RIR / 重量）。** 卧推主项“RPE 8 / 保留 2 次，不做到力竭”在方法论里是明确的，但模板里没有写入 `target_rir`。这属于 Method 数据变更，应该走 importer 出新的 release，不在这个 patch 里改。

## 5. 验证

- `npx tsc --noEmit`：通过
- `npx vitest run`：38 个文件，267 个测试全部通过（新增 `tests/coach/`，19 个）
- `npm run build`：通过（本地构建只用了占位的 Supabase 公钥）
- 没有新增数据库 migration

## 6. 上线后怎么看效果

1. 练完一次拉：训练页第 4 组应该显示“休息-暂停组 · 目标 10 + 5 次”；报告里应该出现“下次推训练……”这样的关键组提示。
2. 午餐分两次保存：第二次保存后的反馈应该按两次的合计来判断。
3. 休息日的日报：不应该出现“该练了”“落后了”之类的话。
4. 如果某个 AI 出口一直显示“基础总结”：在 `ai_status.reason` 里看是不是 `internal_term`。如果是，用对应的开关先关掉拦截，再把原始输出发回来调整 prompt。
