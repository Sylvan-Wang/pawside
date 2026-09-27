# 骨架代码（未接入）

`pawside-ai-p0-0.zip` 是 2026-09-26 在仓库外写的骨架，规格 A0-1 / A0-3 里说的"上一轮骨架"就是它。这些文件从来没有合进 `lib/`。在上一个环境里，15 个单元测试通过，`tsc` 没有报错。

| 文件 | 用途 | 状态 |
|---|---|---|
| `lib/evidence/output-checks.ts` + `tests/ai-eval/output-checks.test.ts` | A0-1 输出检查：裸数字、禁用表述、状态升级、`action_type` 白名单 | **可以直接采用**。注意和今天已经加入的 `lib/coach/display.ts#findInternalTerms`、`composer` 里的输出守卫合并，不要做成两套 |
| `lib/ai/generation-log.ts` + `supabase/migrations/20260926000400_ai_generations.sql` | A0-3 生成日志 | 可以采用。**迁移编号和已有的 `20260926000400_canonical_nutrition_runtime.sql` 冲突，必须重新编号**（取当前最大编号之后的号） |
| `lib/ai/capabilities.ts` | 未来 Chat 编排器的能力清单 | 只作参考，本期不接 |
| `scripts/ai-eval.mts`、`tests/ai-eval/cases.ts`、`composer.integration.test.ts`、`AI_EVAL_README.md` | 评测脚本 | **本期不做**（规格 MUST 7：用户太少，不做统计评测） |

解压方式：`unzip docs/coach/skeletons/pawside-ai-p0-0.zip -d /tmp/p0`，只把要用的文件拷进仓库对应位置。不要把整个目录解压到仓库根目录。
