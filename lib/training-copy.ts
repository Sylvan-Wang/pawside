// User-facing wording for prescriptions. Method rule summaries sometimes carry
// engineering provenance ("组次待严格方法证据", "运行时默认", ...); a user must never
// see those. This keeps the summary when it is plain, and otherwise describes the
// sets that actually exist.

import type { Locale } from './i18n'

const INTERNAL_MARKERS = /严格方法|严格来源|结构化组次|结构初始化|运行时|不得表述|作者原始|product_execution_default|method_explicit|internal beta|Strict Method|runtime/i

interface SummarySet {
  target_reps_min?: number | null
  target_reps_max?: number | null
  target_duration_seconds?: number | null
  target_distance_m?: number | null
}

function describeSets(sets: SummarySet[], locale: Locale): string | null {
  if (sets.length === 0) return null
  const en = locale === 'en'
  const setCount = en ? `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}` : `${sets.length} 组`
  const first = sets[0]
  if (first.target_duration_seconds) {
    const seconds = first.target_duration_seconds
    const minutes = Math.round((seconds / 60) * 10) / 10
    const unit = seconds >= 120
      ? (en ? `${minutes} min` : `${minutes} 分钟`)
      : (en ? `${seconds} sec` : `${seconds} 秒`)
    return sets.length === 1 ? unit : `${setCount} × ${unit}`
  }
  if (first.target_reps_min == null) return setCount
  const reps = first.target_reps_max && first.target_reps_max !== first.target_reps_min
    ? `${first.target_reps_min}–${first.target_reps_max}`
    : `${first.target_reps_min}`
  return en ? `${setCount} × ${reps} reps` : `${setCount} × ${reps} 次`
}

/**
 * The text shown after "今天建议"; null when there is nothing user-worthy to say.
 * The method summary is Chinese method data, so English always describes the sets instead.
 */
export function friendlyTargetSummary(
  summary: string | null | undefined,
  sets: SummarySet[] = [],
  locale: Locale = 'zh',
): string | null {
  if (locale === 'zh' && summary && !INTERNAL_MARKERS.test(summary)) return summary
  return describeSets(sets, locale)
}

export const NO_PRESET_SETS_NOTICE = '这个动作没有预设组次，按你实际完成的情况记录就行，不影响完成训练。'
