import { apiError } from '@/lib/api/response'
import { composeWithEvidence } from '@/lib/evidence/composer'
import { buildDailyReviewEvidence, DAILY_REVIEW_INSTRUCTIONS } from '@/lib/evidence/daily-review'
import { buildNutritionFacts, buildSessionFactsFromLog } from '@/lib/evidence/metric-facts'
import {
  interpretRecordCompleteness,
  interpretSessionDuration,
} from '@/lib/evidence/interpret'
import { computeSessionSignals } from '@/lib/workout/session-facts'
import { computeMealFeedbackStatus } from '@/lib/nutrition/meal-feedback'
import { getDailyNutritionFacts, resolveNutrientTargets } from '@/lib/nutrition/persistence'
import { buildWeeklyAggregate } from '@/lib/nutrition/weekly-log'
import { buildWeeklyReviewInput } from '@/lib/nutrition/weekly-review'
import { loadRecoveryCheckin } from '@/lib/recovery-persistence'
import { describeSelfReport } from '@/lib/recovery'
import { EVIDENCE_REGISTRY_VERSION } from '@/lib/evidence/registry'
import { getWeekStartKey, today } from '@/lib/utils'
import { coachFlag } from '@/lib/coach/flags'
import {
  COACH_PROMPT_VERSION_SUFFIX,
  DAILY_REVIEW_INSTRUCTIONS_V2,
  MEAL_FEEDBACK_INSTRUCTIONS_V2,
  WORKOUT_FEEDBACK_INSTRUCTIONS_V2,
} from '@/lib/coach/prompts'
import { loadMethodWorkoutContext } from '@/lib/coach/workout-context'
import { loadMealContext, mealContextNumbers } from '@/lib/coach/meal-context'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * /api/ai/compose — the AI Composer entry point (AI Patch §25, §26, §27, §29).
 *
 * POST { surface, date | workout_log_id | week_start }
 *
 * This route never hands raw logs to the model. It:
 *   1. builds deterministic MetricFacts (lib/evidence/metric-facts.ts)
 *   2. runs the interpretation engine over the Evidence Registry
 *   3. sends facts + signals + bounded context to the composer
 *   4. lets the composer reject untraceable numbers before they reach a user
 *
 * AI Patch §34 / AC-AI14: a failure here returns 200 with `ai: null` and a
 * reason, because Facts are served by the surface's own endpoint and must keep
 * working when AI is unavailable.
 */

const bodySchema = z.object({
  surface: z.enum(['workout_session_feedback', 'meal_feedback', 'daily_review', 'weekly_review']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  workout_log_id: z.string().uuid().optional(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Coach patch 2026-09-27: lets meal feedback judge the whole meal (all saves
  // of this date + meal_type), not only the latest save. Optional for old clients.
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  time_zone: z.string().trim().min(1).max(100).optional(),
})

function unavailable(reason: string, detail?: string) {
  // Deliberately 200: the AI being unavailable is not a client error, and the
  // caller's Facts layer is unaffected (AI Patch §34).
  return NextResponse.json({
    data: { ai: null },
    ai_status: { available: false, reason, detail: detail ?? null },
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '请检查请求内容', 422, parsed.error.flatten())
  }

  const { surface } = parsed.data
  const promptV2 = coachFlag('COACH_PROMPT_V2')
  const coachOptions = promptV2
    ? { outputGuard: coachFlag('COACH_OUTPUT_GUARD'), promptVersionSuffix: COACH_PROMPT_VERSION_SUFFIX }
    : {}

  try {
    if (surface === 'workout_session_feedback') {
      const logId = parsed.data.workout_log_id
      if (!logId) return apiError('VALIDATION_ERROR', '缺少 workout_log_id', 400)

      const { data: log, error } = await supabase
        .from('workout_logs')
        .select('id,date,type,duration_minutes,exercises,method_workout_session_id')
        .eq('id', logId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!log) return apiError('NOT_FOUND', '训练记录不存在', 404)

      // Coach patch: for Method sessions, read prescription vs actual from the
      // normalized tables. Best-effort; null keeps the previous behaviour.
      const methodContext = coachFlag('COACH_METHOD_CONTEXT') && log.method_workout_session_id
        ? await loadMethodWorkoutContext(supabase, user.id, log.method_workout_session_id)
        : null

      const { session, facts } = buildSessionFactsFromLog({
        exercises: log.exercises,
        // With Method context, duration uses the effective definition and an
        // out-of-range value is dropped (reported via data_issues instead).
        durationMinutes: methodContext
          ? methodContext.duration.minutes
          : log.duration_minutes === null ? null : Number(log.duration_minutes),
      })

      // Layer B signals are decided by rules, and each carries an authority.
      const ruleSignals = computeSessionSignals(session)
      const interpreted = [
        interpretSessionDuration(
          facts.find((fact) => fact.metric_key === 'training.session_duration')!,
          session.data_quality_flags.find((flag) => flag.startsWith('duration_')) ?? null,
        ),
        interpretRecordCompleteness(
          facts.find((fact) => fact.metric_key === 'training.completed_set_count')
            ?? facts[0],
          session.record_completeness,
        ),
      ]

      const checkin = await loadRecoveryCheckin(supabase, user.id, log.date)

      const result = await composeWithEvidence({
        surface,
        facts,
        signals: interpreted,
        context: {
          session_type: log.type,
          record_completeness: session.record_completeness,
          data_quality_flags: session.data_quality_flags,
          rule_signals: ruleSignals,
          // Product §8: recovery is context, never a training decision.
          recovery_context: checkin
            ? {
              sleep_description: describeSelfReport(checkin.sleep_quality_self_report),
              recovery_description: describeSelfReport(checkin.post_workout_recovery_self_report),
            }
            : null,
          exercise_names: session.exercises.map((exercise) => exercise.name),
          method: methodContext
            ? {
              split_label: methodContext.split_label,
              exercises: methodContext.exercises,
              prescribed_not_logged: methodContext.prescribed_not_logged,
              skipped: methodContext.skipped,
            }
            : null,
          next_session: methodContext?.next_session ?? null,
          data_issues: methodContext?.data_issues ?? [],
        },
        extraAllowedNumbers: methodContext?.allowed_numbers,
        instructions: promptV2
          ? WORKOUT_FEEDBACK_INSTRUCTIONS_V2
          : '这是单次训练的即时反馈。只描述这一次训练的事实与已给出的信号，不要评价用户整体健康。',
        ...coachOptions,
      })

      if (!result.ok) return unavailable(result.reason, result.detail)

      return NextResponse.json({
        data: {
          ai: result.data,
          prompt_version: result.promptVersion,
          model: result.model,
          evidence_registry_version: EVIDENCE_REGISTRY_VERSION,
          input_snapshot_id: result.inputSnapshotId,
        },
        ai_status: { available: true, reason: null, detail: null },
      })
    }

    if (surface === 'meal_feedback') {
      const date = parsed.data.date
      if (!date) return apiError('VALIDATION_ERROR', '缺少 date', 400)

      const target = await resolveNutrientTargets(supabase, user.id, date)
      const nutrition = await getDailyNutritionFacts(supabase, user.id, date, target)
      const facts = buildNutritionFacts(nutrition)
      const interpreted = computeMealFeedbackStatus(nutrition)
      const mealContext = coachFlag('COACH_MEAL_CONTEXT') && parsed.data.meal_type
        ? await loadMealContext(supabase, {
          userId: user.id,
          date,
          mealType: parsed.data.meal_type,
          target,
        })
        : null

      const result = await composeWithEvidence({
        surface,
        facts,
        // Meal status already carries domain + evidence_ref_ids from the status
        // layer, so the composer can bind claims without re-deriving anything.
        signals: interpreted.map((status) => ({
          metric_key: status.metric_key,
          status: status.status,
          domain: status.domain,
          evidence_ref_ids: status.evidence_ref_ids,
          evidence_level: null,
          confidence: 'medium',
          allowed_claim: status.explanation,
          authority: status.authority,
        })),
        context: {
          meal_date: date,
          meal_count: nutrition.meal_count,
          data_completeness: nutrition.data_completeness,
          target: nutrition.target,
          consumed: nutrition.consumed,
          remaining: nutrition.remaining,
          this_meal: mealContext
            ? {
              meal: mealContext.meal_label,
              saves_merged: mealContext.save_count,
              items: mealContext.item_names,
              totals: mealContext.totals,
              position: mealContext.position,
              has_estimated_items: mealContext.has_estimated_items,
            }
            : null,
          meal_ref: mealContext?.meal_ref ?? null,
          day: {
            is_today: date === today(parsed.data.time_zone ?? 'UTC'),
            consumed: nutrition.consumed,
            remaining: nutrition.remaining,
          },
        },
        extraAllowedNumbers: mealContextNumbers(mealContext),
        instructions: promptV2
          ? MEAL_FEEDBACK_INSTRUCTIONS_V2
          : '这是保存一餐后的即时反馈。只解释已经计算好的目标、已摄入和剩余额度，不要自行换算食物克数或重新计算营养数值。',
        ...coachOptions,
      })

      if (!result.ok) return unavailable(result.reason, result.detail)

      return NextResponse.json({
        data: {
          ai: result.data,
          prompt_version: result.promptVersion,
          model: result.model,
          evidence_registry_version: EVIDENCE_REGISTRY_VERSION,
          input_snapshot_id: result.inputSnapshotId,
        },
        ai_status: { available: true, reason: null, detail: null },
      })
    }

    if (surface === 'daily_review') {
      const date = parsed.data.date
      if (!date) return apiError('VALIDATION_ERROR', '缺少 date', 400)

      const evidence = await buildDailyReviewEvidence(supabase, {
        userId: user.id,
        date,
        today: today(parsed.data.time_zone ?? 'UTC'),
      })
      const result = await composeWithEvidence({
        surface,
        facts: evidence.facts,
        signals: evidence.signals,
        context: evidence.context,
        instructions: promptV2 ? DAILY_REVIEW_INSTRUCTIONS_V2 : DAILY_REVIEW_INSTRUCTIONS,
        ...coachOptions,
      })

      if (!result.ok) return unavailable(result.reason, result.detail)

      return NextResponse.json({
        data: {
          ai: result.data,
          facts: evidence.facts,
          signals: evidence.signals,
          prompt_version: result.promptVersion,
          model: result.model,
          evidence_registry_version: EVIDENCE_REGISTRY_VERSION,
          input_snapshot_id: result.inputSnapshotId,
        },
        ai_status: { available: true, reason: null, detail: null },
      })
    }

    // surface === 'weekly_review'
    const weekStart = parsed.data.week_start
      ?? getWeekStartKey(new Date(), parsed.data.time_zone ?? 'UTC')
    const aggregate = await buildWeeklyAggregate(supabase, user.id, weekStart)
    const reviewInput = buildWeeklyReviewInput(aggregate)

    const result = await composeWithEvidence({
      surface,
      facts: [],
      signals: [],
      context: reviewInput as unknown as Record<string, unknown>,
      instructions:
        '这是周复盘。趋势方向已经由规则引擎判定，你必须复用 computed_trends 中的描述，不得自行判断趋势。'
        + '如果某个趋势为 insufficient，必须原样表达数据不足。不得复述七份每日复盘。',
    })

    if (!result.ok) return unavailable(result.reason, result.detail)

    return NextResponse.json({
      data: {
        ai: result.data,
        review_input: reviewInput,
        prompt_version: result.promptVersion,
        model: result.model,
        evidence_registry_version: EVIDENCE_REGISTRY_VERSION,
        input_snapshot_id: result.inputSnapshotId,
      },
      ai_status: { available: true, reason: null, detail: null },
    })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法生成反馈',
      500,
    )
  }
}
