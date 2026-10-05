// User-facing wording for prescriptions. Method rule summaries sometimes carry
// engineering provenance ("组次待严格方法证据", "运行时默认", ...); a user must never
// see those. This keeps the summary when it is plain, and otherwise describes the
// sets that actually exist.

const INTERNAL_MARKERS = /严格方法|严格来源|结构化组次|结构初始化|运行时|不得表述|作者原始|product_execution_default|method_explicit|internal beta|Strict Method|runtime/i

interface SummarySet {
  target_reps_min?: number | null
  target_reps_max?: number | null
  target_duration_seconds?: number | null
  target_distance_m?: number | null
}

function describeSets(sets: SummarySet[]): string | null {
  if (sets.length === 0) return null
  const first = sets[0]
  if (first.target_duration_seconds) {
    const seconds = first.target_duration_seconds
    const unit = seconds >= 120 ? `${Math.round((seconds / 60) * 10) / 10} 分钟` : `${seconds} 秒`
    return sets.length === 1 ? unit : `${sets.length} 组 × ${unit}`
  }
  if (first.target_reps_min == null) return `${sets.length} 组`
  const reps = first.target_reps_max && first.target_reps_max !== first.target_reps_min
    ? `${first.target_reps_min}–${first.target_reps_max}`
    : `${first.target_reps_min}`
  return `${sets.length} 组 × ${reps} 次`
}

/** The text shown after "今天建议"; null when there is nothing user-worthy to say. */
export function friendlyTargetSummary(summary: string | null | undefined, sets: SummarySet[] = []): string | null {
  if (summary && !INTERNAL_MARKERS.test(summary)) return summary
  return describeSets(sets)
}

export const NO_PRESET_SETS_NOTICE = '这个动作没有预设组次，按你实际完成的情况记录就行，不影响完成训练。'
