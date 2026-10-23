import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { getChatModel } from '../../lib/ai-client'
import { createPlanner } from '../../lib/coach-chat/planner'
import { buildPlannerInput, COACH_CHAT_SYSTEM_PROMPT, weekdayOf } from '../../lib/coach-chat/prompt'
import { normalizePlan, PLAN_PROMPT_VERSION } from '../../lib/coach-chat/schemas'
import { CASES, TODAY } from './fixtures'

/**
 * Sends every fixture to the REAL model and judges the plan with the same checks the gold plans pass.
 *
 *   npm run coach:eval                      one run per case
 *   PAWSIDE_EVAL_RUNS=3 npm run coach:eval  repeat each case (the model is not deterministic)
 *   PAWSIDE_EVAL_ONLY=meal npm run coach:eval  only cases whose id or group contains "meal"
 *
 * Needs OPENAI_API_KEY (and OPENAI_CHAT_MODEL / OPENAI_MODEL) in the environment or .env.local.
 * It is NOT part of `npm test`: it costs money and its result depends on the model.
 * A failing case means "the model's plan would record something different from what the user said":
 * read the printed plan before deciding whether the prompt, the schema or the fixture is wrong.
 */

const runs = Math.max(1, Number(process.env.PAWSIDE_EVAL_RUNS ?? '1'))
const only = process.env.PAWSIDE_EVAL_ONLY?.trim()
const selected = only ? CASES.filter((c) => c.id.includes(only) || c.group.includes(only)) : CASES
const tz = 'Asia/Shanghai'

interface Outcome { id: string; group: string; run: number; ok: boolean; problems: string[]; latencyMs: number; tokensIn: number | null; tokensOut: number | null; summary: string }
const outcomes: Outcome[] = []

describe.skipIf(!process.env.OPENAI_API_KEY)(`planner vs real model (${PLAN_PROMPT_VERSION})`, { timeout: 90_000 }, () => {
  const planner = createPlanner()

  for (const testCase of selected) {
    for (let run = 1; run <= runs; run += 1) {
      it.concurrent(`${testCase.id}${runs > 1 ? ` #${run}` : ''}`, async () => {
        const input = buildPlannerInput({
          today: TODAY,
          weekday: weekdayOf(TODAY),
          localHour: testCase.hour ?? 13,
          timeZone: tz,
          recentMessages: testCase.recent ?? [],
          openDrafts: (testCase.openDrafts ?? []).map((d) => ({ id: d.id, kind: d.kind, summary: d.summary, pendingQuestion: d.pendingQuestion ?? null })),
          userMessage: testCase.say,
        })
        const result = await planner(COACH_CHAT_SYSTEM_PROMPT, input)
        if (!result.ok) {
          outcomes.push({ id: testCase.id, group: testCase.group, run, ok: false, problems: [`model call failed: ${result.reason}`], latencyMs: result.latencyMs, tokensIn: null, tokensOut: null, summary: '' })
          expect.fail(`model call failed: ${result.reason}`)
        }
        const plan = normalizePlan(result.plan)
        const problems = testCase.check(plan)
        outcomes.push({
          id: testCase.id, group: testCase.group, run, ok: problems.length === 0, problems,
          latencyMs: result.latencyMs, tokensIn: result.usage?.inputTokens ?? null, tokensOut: result.usage?.outputTokens ?? null,
          summary: JSON.stringify({ tasks: plan.tasks, reply: plan.reply, clarification: plan.clarification, issues: plan.issues }),
        })
        // On failure the plan is printed so the reader can judge the model, the prompt or the fixture.
        expect(problems, `${testCase.say}\n${outcomes[outcomes.length - 1].summary}`).toEqual([])
      })
    }
  }

  afterAll(() => {
    const passed = outcomes.filter((o) => o.ok).length
    const latencies = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b)
    const pick = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0
    const sum = (values: Array<number | null>) => values.reduce<number>((total, v) => total + (v ?? 0), 0)
    const byGroup = new Map<string, { ok: number; total: number }>()
    for (const o of outcomes) {
      const g = byGroup.get(o.group) ?? { ok: 0, total: 0 }
      g.total += 1
      if (o.ok) g.ok += 1
      byGroup.set(o.group, g)
    }
    const report = {
      model: getChatModel(), promptVersion: PLAN_PROMPT_VERSION, runsPerCase: runs, cases: selected.length,
      passed, total: outcomes.length,
      latencyMs: { p50: pick(0.5), p95: pick(0.95), max: latencies[latencies.length - 1] ?? 0 },
      tokens: { input: sum(outcomes.map((o) => o.tokensIn)), output: sum(outcomes.map((o) => o.tokensOut)) },
      byGroup: Object.fromEntries([...byGroup].map(([k, v]) => [k, `${v.ok}/${v.total}`])),
      failures: outcomes.filter((o) => !o.ok).map((o) => ({ id: o.id, run: o.run, problems: o.problems, plan: o.summary })),
    }
    mkdirSync('tests/eval/results', { recursive: true })
    writeFileSync('tests/eval/results/latest.json', JSON.stringify({ ...report, outcomes }, null, 2))
    console.log(`\n=== planner eval: ${passed}/${outcomes.length} passed · model ${report.model} · p50 ${report.latencyMs.p50} ms · p95 ${report.latencyMs.p95} ms ===`)
    console.log('by group:', report.byGroup)
    for (const failure of report.failures) console.log(`✗ ${failure.id}#${failure.run}: ${failure.problems.join(' | ')}`)
    console.log('details: tests/eval/results/latest.json')
  })
})
