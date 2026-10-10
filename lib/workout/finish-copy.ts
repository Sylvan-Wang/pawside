import { kgToWeightInput, type TrainingWeightUnit } from '@/lib/training-weight-unit'
import { splitLabel } from '@/lib/split-labels'
import type { SessionHighlight } from '@/lib/workout/session-highlight'

/**
 * Copy for the screen shown right after a training day is finished.
 *
 * Order follows the peak-end rule: the peak first (what is worth remembering),
 * the details folded away, and the end last (what happens next). Numbers come
 * from rules and the database, never from a model. No streaks, no "you must".
 */
export interface FinishCompletion {
  next_split_key: string
  current_cycle_number: number
  cycle_completed: boolean
  program_day_completed?: boolean
  progression_advanced: boolean
  log_date: string
}

export interface FinishCopy {
  headline: string
  /** Second line under the headline, when there is a highlight to state. */
  detail: string | null
  /** Only a finished cycle earns a sticker; keep it rare so it stays a peak. */
  celebrate: boolean
  /** The "end": what comes next, or why this one did not move the plan. */
  next: string
}

function show(valueKg: number, unit: TrainingWeightUnit) {
  return kgToWeightInput(valueKg, unit)
}

export function highlightCopy(highlight: SessionHighlight, unit: TrainingWeightUnit): { headline: string; detail: string } {
  if (highlight.kind === 'weight_up') {
    return {
      headline: `${highlight.exercise}比上次重了`,
      detail: `${show(highlight.from_kg, unit)} → ${show(highlight.to_kg, unit)} ${unit}`,
    }
  }
  return {
    headline: `${highlight.exercise}同样的重量多做了 ${highlight.to_reps - highlight.from_reps} 次`,
    detail: `${show(highlight.weight_kg, unit)} ${unit} × ${highlight.from_reps} → ${highlight.to_reps} 次`,
  }
}

export function finishCopy(
  completion: FinishCompletion | null,
  highlight: SessionHighlight | null,
  unit: TrainingWeightUnit,
): FinishCopy {
  const advanced = completion ? (completion.program_day_completed ?? completion.progression_advanced) : true
  const picked = highlight ? highlightCopy(highlight, unit) : null

  if (completion && !advanced) {
    return {
      headline: '这次补充训练记下了',
      detail: picked ? `${picked.headline}（${picked.detail}）` : null,
      celebrate: false,
      next: `已归入 ${completion.log_date}，不影响原来的训练顺序。`,
    }
  }

  const next = completion ? `下一次：${splitLabel(completion.next_split_key)}训练` : '这次的记录已经保存。'

  if (completion?.cycle_completed) {
    return {
      headline: `第 ${completion.current_cycle_number - 1} 轮练完了`,
      detail: picked ? `${picked.headline}（${picked.detail}）` : null,
      celebrate: true,
      next,
    }
  }

  if (picked) return { headline: picked.headline, detail: picked.detail, celebrate: false, next }
  return { headline: '今天练完了', detail: null, celebrate: false, next }
}
