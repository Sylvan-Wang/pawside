import type { SupabaseClient } from '@supabase/supabase-js'

/** Cache content types that depend on a day's facts. */
export const DAY_CACHE_CONTENT_TYPES = ['daily_review_ai', 'daily_summary'] as const

/** Client-side cache keys that go stale when a day's facts change. */
export function dayCacheKeys(date: string): string[] {
  return [
    `ai_review_${date}`,
    `ai_summary_${date}`,
    `ai_review_v3_${date}`,
    `ai_summary_v3_${date}`,
  ]
}

/**
 * Drops every cached artifact derived from a day's facts.
 *
 * Call after any create/update/delete on workout_logs, food_logs,
 * body_metrics, recovery, or the nutrition targets.
 *
 * Product §21 requires that a mutation makes the day's Log stale rather than
 * leaving the pre-save result on screen. Two independent caches have to be
 * cleared, and previously only the DB one was:
 *   - `ai_generated_content` (both `daily_review_ai` and `daily_summary`)
 *   - `sessionStorage` (`ai_review_<date>`, `ai_summary_<date>`)
 */
export async function invalidateDayDerivedCache(
  supabase: SupabaseClient,
  userId: string,
  date: string,
) {
  const { error } = await supabase
    .from('ai_generated_content')
    .delete()
    .eq('user_id', userId)
    .eq('target_date', date)
    .in('content_type', [...DAY_CACHE_CONTENT_TYPES])

  if (typeof window !== 'undefined') {
    for (const key of dayCacheKeys(date)) window.sessionStorage.removeItem(key)
  }

  return {
    ok: !error,
    error: error?.message ?? null,
  }
}

/**
 * @deprecated Use {@link invalidateDayDerivedCache}, which also clears the rule
 * `daily_summary` cache and the client-side sessionStorage keys. Retained so
 * existing callers keep compiling during the migration.
 */
export async function invalidateAIReview(
  supabase: SupabaseClient,
  userId: string,
  date: string,
) {
  await supabase
    .from('ai_generated_content')
    .delete()
    .eq('user_id', userId)
    .eq('content_type', 'daily_review_ai')
    .eq('target_date', date)
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Formats a Date with local calendar parts; never shifts it through UTC. */
export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Formats an instant as a calendar date in an explicit IANA timezone. */
export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: 'year' | 'month' | 'day') =>
    parts.find((part) => part.type === type)?.value
  const year = value('year')
  const month = value('month')
  const day = value('day')
  if (!year || !month || !day) throw new Error('无法解析用户时区日期')
  return `${year}-${month}-${day}`
}

/** Calendar arithmetic on YYYY-MM-DD without host-timezone conversions. */
export function shiftDateKey(dateKey: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('无效日期')
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

/** Monday date key for a local/user-timezone calendar week. */
export function getWeekStartKey(
  value: Date | string = new Date(),
  timeZone?: string,
): string {
  const dateKey = typeof value === 'string'
    ? value
    : timeZone
      ? dateKeyInTimeZone(value, timeZone)
      : formatLocalDateKey(value)
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return shiftDateKey(dateKey, offset)
}

export function formatDate(date: Date | string): string {
  const d = new Date(date)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function today(timeZone?: string): string {
  const now = new Date()
  return timeZone ? dateKeyInTimeZone(now, timeZone) : formatLocalDateKey(now)
}

export function generateWeeklySummary(
  workoutCount: number,
  totalDuration: number,
  foodLogCount: number,
  avgCalories: number | null,
  weightChange: number | null,
  target: number | null
) {
  const lines: string[] = []
  if (target === null) {
    /*
     * Product §4 / Guardrail §2.2: an unset weekly target is NOT 3. The old
     * `|| 3` fallback turned "user never set a goal" into a fake 3/3 comparison
     * (Phase 0 baseline §3.2). Report the raw count and prompt to set a target.
     */
    lines.push(workoutCount > 0
      ? `本周完成了 ${workoutCount} 次训练`
      : '本周暂无训练记录，下周加油！')
  } else if (workoutCount >= target) {
    lines.push(`本周你完成了 ${workoutCount} 次训练，达成目标 👍`)
  } else if (workoutCount > 0) {
    lines.push(`本周完成了 ${workoutCount} 次训练，距目标还差 ${target - workoutCount} 次`)
  } else {
    lines.push('本周暂无训练记录，下周加油！')
  }

  if (foodLogCount >= 14) {
    lines.push('饮食记录较稳定，可以继续保持')
  } else if (foodLogCount > 0) {
    lines.push(`本周记录了 ${foodLogCount} 次饮食，建议保持更规律的记录习惯`)
  }

  if (weightChange !== null) {
    if (weightChange < 0) {
      lines.push(`体重下降 ${Math.abs(weightChange).toFixed(1)} kg，状态不错`)
    } else if (weightChange > 0) {
      lines.push(`体重上升 ${weightChange.toFixed(1)} kg，注意饮食控制`)
    }
  }

  return lines.join('。')
}
