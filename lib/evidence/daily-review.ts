import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDailyLog, type DailyLog } from '../nutrition/daily-log'
import type { InterpretedSignal, MetricFact } from '../nutrition/interpretation'
import { buildNutritionFacts } from './metric-facts'
import { interpretRecovery, metricFact } from './interpret'

/**
 * Canonical Daily Review input.
 *
 * The model receives only deterministic MetricFacts, rule-produced signals and
 * a bounded context. Raw workout/food rows never cross this boundary.
 */
export interface DailyReviewEvidence {
  log: DailyLog
  facts: MetricFact[]
  signals: InterpretedSignal[]
  context: Record<string, unknown>
}

function dayFact(input: {
  metricKey: string
  value: number | null
  unit: string | null
  basis: unknown
  completeness: 'complete' | 'partial' | 'unknown'
}): MetricFact {
  return metricFact({
    metricKey: input.metricKey,
    value: input.value,
    unit: input.unit,
    window: 'day',
    calculationBasis: input.basis,
    dataCompleteness: input.completeness,
  })
}

export async function buildDailyReviewEvidence(
  supabase: SupabaseClient,
  input: { userId: string; date: string; today: string },
): Promise<DailyReviewEvidence> {
  const log = await buildDailyLog(supabase, input)
  const completeness = log.summary.data_completeness
  const facts = buildNutritionFacts(log.nutrition)

  facts.push(
    dayFact({
      metricKey: 'training.workout_count',
      value: log.summary.workout_count,
      unit: null,
      basis: { source: 'workout_logs', date: log.date },
      completeness,
    }),
    dayFact({
      metricKey: 'training.duration_minutes',
      value: log.summary.total_duration_minutes,
      unit: 'min',
      basis: { source: 'workout_logs.duration_minutes', date: log.date },
      completeness,
    }),
    dayFact({
      metricKey: 'nutrition.logged_item_count',
      value: log.summary.logged_item_count,
      unit: null,
      basis: { source: 'user_food_log_items', date: log.date },
      completeness,
    }),
  )

  if (log.body) {
    facts.push(
      dayFact({
        metricKey: 'body.weight_kg',
        value: log.body.weight_kg,
        unit: 'kg',
        basis: { source: 'body_metrics', date: log.date },
        completeness: log.body.weight_kg === null ? 'unknown' : 'complete',
      }),
      dayFact({
        metricKey: 'body.body_fat_pct',
        value: log.body.body_fat_pct,
        unit: '%',
        basis: { source: 'body_metrics', date: log.date },
        completeness: log.body.body_fat_pct === null ? 'unknown' : 'complete',
      }),
      dayFact({
        metricKey: 'body.muscle_mass_kg',
        value: log.body.muscle_mass,
        unit: 'kg',
        basis: { source: 'body_metrics', date: log.date },
        completeness: log.body.muscle_mass === null ? 'unknown' : 'complete',
      }),
    )
  }

  const sleepFact = dayFact({
    metricKey: 'recovery.sleep_quality_self_report',
    value: log.recovery.sleep_quality_self_report,
    unit: null,
    basis: { source: 'recovery_checkins', subjective: true, date: log.date },
    completeness: log.recovery.recorded ? 'complete' : 'unknown',
  })
  const recoveryFact = dayFact({
    metricKey: 'recovery.post_workout_self_report',
    value: log.recovery.post_workout_recovery_self_report,
    unit: null,
    basis: { source: 'recovery_checkins', subjective: true, date: log.date },
    completeness: log.recovery.recorded ? 'complete' : 'unknown',
  })
  facts.push(sleepFact, recoveryFact)

  const nutritionSignals: InterpretedSignal[] = log.status.map((status) => ({
    metric_key: status.metric_key,
    status: status.status,
    domain: status.domain,
    evidence_ref_ids: status.evidence_ref_ids,
    evidence_level: null,
    confidence: 'medium',
    allowed_claim: status.explanation,
    authority: status.authority,
  }))

  const signals = [
    ...nutritionSignals,
    interpretRecovery(sleepFact),
    interpretRecovery(recoveryFact),
  ]

  return {
    log,
    facts,
    signals,
    context: {
      date: log.date,
      period_label: log.period_label,
      is_today: log.is_today,
      data_completeness: log.summary.data_completeness,
      recovery_descriptions: {
        sleep: log.recovery.sleep_description,
        post_workout: log.recovery.recovery_description,
      },
    },
  }
}

export const DAILY_REVIEW_INSTRUCTIONS =
  '这是每日复盘。只解释 supplied facts 与 computed signals，不得读取原始日志或自行计算。'
  + '输出优先级固定为：训练安全或数据完整性、营养状态、训练事实、主观恢复、身体记录。'
  + '最多给出 3 个 key findings；当日尚未结束时，不得把截至目前的摄入判断为全天不足。'
  + '主观恢复只作背景，不得据此修改训练处方或宣布用户不能训练。'
