import { dateKeyInTimeZone, shiftDateKey } from '../utils'

/**
 * Date and meal-slot rules for the chat assistant (Patch §5).
 *
 * The model only ever says WHICH relative day the user meant ("昨天"); the
 * calendar date is computed here, from the server clock and the user's IANA
 * time zone. A model-supplied explicit date is validated, never trusted.
 */

export type DateRefKind = 'unspecified' | 'today' | 'yesterday' | 'day_before_yesterday' | 'explicit'
export type DateSource = 'default' | 'relative' | 'explicit'
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/** How far back a chat may write. Older corrections go through the manual pages. */
export const MAX_BACKFILL_DAYS = 180

export type DateResolution =
  | { ok: true; date: string; source: DateSource }
  | { ok: false; reason: 'invalid_date' | 'future_date' | 'too_old' }

/** Returns the zone if Intl accepts it, otherwise null. Never falls back to UTC. */
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const zone = value.trim()
  if (!zone || zone.length > 100) return null
  try {
    dateKeyInTimeZone(new Date(), zone)
    return zone
  } catch {
    return null
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

/** Whole days from `earlier` to `later` (both YYYY-MM-DD). */
function daysBetween(earlier: string, later: string): number {
  const toUtc = (key: string) => {
    const [year, month, day] = key.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000)
}

export function resolveDateRef(
  ref: DateRefKind,
  explicitDate: string | null,
  timeZone: string,
  now: Date,
): DateResolution {
  const today = dateKeyInTimeZone(now, timeZone)

  if (ref === 'unspecified' || ref === 'today') {
    return { ok: true, date: today, source: ref === 'today' ? 'relative' : 'default' }
  }
  if (ref === 'yesterday') return { ok: true, date: shiftDateKey(today, -1), source: 'relative' }
  if (ref === 'day_before_yesterday') return { ok: true, date: shiftDateKey(today, -2), source: 'relative' }

  if (!explicitDate || !isCalendarDate(explicitDate)) return { ok: false, reason: 'invalid_date' }
  if (explicitDate > today) return { ok: false, reason: 'future_date' }
  if (daysBetween(explicitDate, today) > MAX_BACKFILL_DAYS) return { ok: false, reason: 'too_old' }
  return { ok: true, date: explicitDate, source: 'explicit' }
}

/** Local wall-clock hour (0-23) in the user's zone. */
export function localHour(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('无法解析用户时区的小时')
  return hour
}

/**
 * A default meal slot from the clock, used ONLY when the user did not say
 * which meal and the record is for today. It is shown on the card as a guess
 * ("按时间推测"); it is never presented as something the user said.
 */
export function inferMealSlot(hour: number): MealSlot {
  if (hour >= 4 && hour < 10) return 'breakfast'
  if (hour >= 10 && hour < 14) return 'lunch'
  if (hour >= 14 && hour < 17) return 'snack'
  if (hour >= 17 && hour < 22) return 'dinner'
  return 'snack'
}

/**
 * "晚饭" typed at 1 a.m. with no date: is it last night's dinner or an early
 * dinner today? That changes which day the fact belongs to, so it is exactly
 * the kind of question worth the one clarification (Patch §3.3 / §5).
 */
export function isLateNightAmbiguous(input: {
  meal: MealSlot | null
  dateSource: DateSource
  hour: number
}): boolean {
  return input.dateSource === 'default'
    && (input.meal === 'dinner' || input.meal === 'snack')
    && input.hour < 5
}

export function describeDate(date: string, today: string): string {
  if (date === today) return '今天'
  if (date === shiftDateKey(today, -1)) return '昨天'
  if (date === shiftDateKey(today, -2)) return '前天'
  const [, month, day] = date.split('-').map(Number)
  return `${month}月${day}日`
}
