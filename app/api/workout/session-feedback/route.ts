import { apiError } from '@/lib/api/response'
import { loadFeedback } from '@/lib/feedback'
import { loadRecoveryCheckin } from '@/lib/recovery-persistence'
import { describeSelfReport } from '@/lib/recovery'
import { computeSessionFacts, computeSessionSignals } from '@/lib/workout/session-facts'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * /api/workout/session-feedback — Workout Result facts (Product §12 / §13)
 *
 * GET ?workout_log_id=<uuid>
 *
 * Returns the three Product §13 layers, with Layer C left as a container:
 *   Layer A  facts     — only what the database really holds
 *   Layer B  signals   — only what a rule can determine, each with an authority
 *   Layer C  ai        — null until the AI Composer phase lands
 *
 * AI Patch §34 / AC-AI14: with no AI, Layers A and B must still fully render.
 * This route therefore never requires an AI call to succeed.
 *
 * Product §12.1 / AC-P09: feedback is addressed by `workout_log_id`, so two
 * sessions on the same day each get their own rating.
 */

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const workoutLogId = request.nextUrl.searchParams.get('workout_log_id')
  if (!workoutLogId) {
    return apiError('VALIDATION_ERROR', '缺少 workout_log_id', 400)
  }

  try {
    const { data: log, error } = await supabase
      .from('workout_logs')
      .select('id,date,type,duration_minutes,notes,exercises,method_workout_session_id')
      .eq('id', workoutLogId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!log) return apiError('NOT_FOUND', '训练记录不存在', 404)

    const durationMinutes = log.duration_minutes === null ? null : Number(log.duration_minutes)

    const facts = computeSessionFacts({
      exercises: log.exercises,
      durationMinutes,
      type: log.type,
    })
    const signals = computeSessionSignals(facts)

    // Recovery is context only. It must never be turned into "you cannot train"
    // (Product §8), so it is returned as a description, not a decision.
    const checkin = await loadRecoveryCheckin(supabase, user.id, log.date)
    const recoveryContext = checkin
      ? {
        checkin_date: checkin.checkin_date,
        sleep_description: describeSelfReport(checkin.sleep_quality_self_report),
        recovery_description: describeSelfReport(checkin.post_workout_recovery_self_report),
      }
      : null

    const rating = await loadFeedback(supabase, user.id, 'workout_session_feedback', log.id)

    return NextResponse.json({
      data: {
        // Layer A
        facts: {
          workout_log_id: log.id,
          date: log.date,
          type: log.type,
          method_workout_session_id: log.method_workout_session_id,
          duration_minutes: durationMinutes,
          notes: log.notes,
          exercise_count: facts.exercise_count,
          completed_exercise_count: facts.completed_exercise_count,
          completed_set_count: facts.completed_set_count,
          total_volume_kg: facts.total_volume_kg,
          record_completeness: facts.record_completeness,
          exercises: facts.exercises,
          data_quality_flags: facts.data_quality_flags,
        },
        // Layer B
        signals,
        // Layer C container — filled by the AI Composer phase.
        ai: null,
        recovery_context: recoveryContext,
        feedback: rating
          ? { rating: rating.rating, prompt_version: rating.prompt_version, model: rating.model }
          : null,
      },
    })
  } catch (reason: unknown) {
    return apiError(
      'DATABASE_ERROR',
      reason instanceof Error ? reason.message : '暂时无法读取本次训练反馈',
      500,
    )
  }
}
