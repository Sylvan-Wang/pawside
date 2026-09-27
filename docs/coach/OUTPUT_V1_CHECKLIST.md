# B6 · 打开 `coach_output_v1` 之前的检查单

依据：`docs/coach/OUTPUT_EXAMPLES.md`（训练反馈、餐后反馈两个示例）。对照的代码版本：T4（`a54e89a`）+ B1–B5。

**结论：没有发现需要改代码的 wiring bug。** 下面逐项记录检查过程，以及两个不在这次范围内、但值得记一笔的发现。

## 1. `allowed_actions` 是不是真的传进去了

| Surface | 传了什么 | 跟 OUTPUT_EXAMPLES.md 对不对得上 |
|---|---|---|
| 训练反馈 | `computeAllowedActions({surface:'workout_session_feedback', hasIncompleteRecord, hasNextSession})` → 有缺失记录时含 `complete_record`，有下一次训练时含 `view_next_session`，总是含 `none` | 示例给的是 `["complete_record", "view_next_session", "none"]`，顺序和内容完全一致 |
| 餐后反馈 | `computeAllowedActions({surface:'meal_feedback'})` → `["log_meal", "none"]` | 示例给的就是 `["log_meal", "none"]`，一致 |
| 日报 | `computeAllowedActions({surface:'daily_review', hasNextSession, hasRecoveryCheckinToday})` | OUTPUT_EXAMPLES.md 没给日报的示例，按 A0-4 的字段表和 D10/D11 的精神检查了一遍，逻辑自洽 |

确认了三个 surface 在 `app/api/ai/compose/route.ts` 和 `app/api/ai/daily-review/route.ts` 里都是：算好 `allowedActions` → 放进 `context.allowed_actions`（给模型看）→ 同时作为 `allowedActions` 传给 `composeWithEvidence`（给 `output-checks.ts#findInvalidActionTypes` 拦截用）。两条路径都接上了，没有漏掉哪一个。

## 2. 训练和饮食反馈的 evidence 条数上限

`lib/evidence/coach-output.ts#CAPS`：

```
workout_session_feedback: { evidence: 2, actions: 2 }
meal_feedback:             { evidence: 1, actions: 1 }
daily_review:               { evidence: 2, actions: 2 }
```

跟 A0-4 规格"各节点上限"表、以及 OUTPUT_EXAMPLES.md 两个示例（训练反馈"最多 2 条 evidence、2 个行动"，餐后反馈"最多 1 条 evidence、1 个行动"）完全一致，`buildCoachOutputSchema` 的 `maxItems` 也是按这个表生成的。

## 3. `compatibleReview` 转成旧字段后，旧页面还能不能正常显示

逐个 surface 对照了 `compatibleReview()` 的输出和对应页面实际读的字段：

| Surface | `compatibleReview` 输出 | 页面读的字段 | 对不对得上 |
|---|---|---|---|
| 训练反馈 | `{summary, observations:[{text,...}], next_actions:[{text,basis}], data_quality_tip}` | `app/training/sessions/[sessionId]/page.tsx`：`ai.summary`、`observations[].text`、`next_actions[].text` | 对得上 |
| 餐后反馈 | 同上 + `safety_note`（`output.safety.text`） | `app/food/FoodPageClient.tsx`：`ai.summary`、`observations[].text`、`next_actions[].text` | `summary`/`observations`/`next_actions` 对得上；`safety_note` 见下面"发现但这次没修"第 1 条 |
| 日报 | `{overall, key_findings:[{text,domain,evidence_ref_ids}], tomorrow_guidance:[{text,basis}], safety, data_quality_tip}`，跟 `app/api/ai/daily-review/route.ts` 自己的 `DailyReviewOutput` 接口逐字段一致 | `app/api/ai/daily-review/route.ts` 里已有的 `compatibleReview()`（旧的那个，转成 `{summary,insights,actions,...}`）接着转一遍，Home/History 读的是这一层 | 两层转换首尾对上，Home/History 不用改 |

顺手确认了三个 surface 用的 schema 都是 `additionalProperties: false` + 顶层 `strict: true`（`lib/ai-client.ts:181`，对所有 surface 统一生效，不是分开配置的），符合 A0-4 的 MUST。

## 发现但这次没有改的（不在这次三项检查范围内）

**都不是 coach_output_v1 引入的新问题，是打开开关之前就存在的旧缺口，记录下来供你决定要不要另开任务。**

1. **`safety_note`（餐后）/`safety`（日报）算出来了，但页面从来没有显示过。** 这个字段在旧的 `mealFeedbackSchema`/`dailyReviewSchemaV2` 里本来就是必填字段，`compatibleReview` 也老老实实转了出来，但 `FoodPageClient.tsx` 的 `MealFeedbackView.ai` 类型里根本没有 `safety_note` 这个字段，Home/History 也没有读 `review.safety`——这不是这次 patch 造成的，是从一开始就没接的功能缺口。按"B6 不写新功能"的要求，这次没有加这个显示（加的话至少要给 `CoachCard` 补一个"有内容时置顶"的安全提示位，属于新 UI，不是"修 wiring"）。如果你想要，我可以另开一个任务做。
2. **`docs/coach/OUTPUT_EXAMPLES.md` 训练反馈那段说"标题 ≤30 字"，但 A0-4 规格的字段表写的是 `headline` 全部 surface 统一 ≤40 字，代码（`buildCoachOutputSchema`）按的是 40。** 怀疑是写示例文档时顺手抄了旧 v2 prompt 里"summary 不超过 30 个汉字"的措辞，不是刻意要给训练反馈单独定一个更严的标题上限。这次没有改代码去迁就文档（40 是规格原文），但这个文档措辞不一致的地方需要你确认一下哪个是对的，如果是文档写错了，麻烦顺手改一下 `OUTPUT_EXAMPLES.md`。

## 结论

`allowed_actions` 三个 surface 都真正传进了 context 也传进了输出检查；evidence/next_actions 的条数上限跟示例和规格一致；`compatibleReview` 转出来的旧字段跟三个页面实际读的字段逐一对得上，打开 `PAWSIDE_COACH_OUTPUT_V1` 不会破坏 History、训练页、饮食页现有的显示逻辑。上面两条"发现但没修"的缺口不影响这个结论。
