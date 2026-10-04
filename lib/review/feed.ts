export type ReviewTier = 'day' | 'week' | 'month'

export interface ReviewSettings {
  day_enabled: boolean
  week_enabled: boolean
  month_enabled: boolean
  generation_mode: 'auto' | 'manual'
  pin_mode: 'until_read' | 'three_days'
}

export interface ReviewAvailability {
  tier: ReviewTier
  period_start: string
  record_days: number
  workout_count: number
  has_ai?: boolean
}

export interface ReviewFeedItem extends ReviewAvailability {
  period_end: string
  current: boolean
  unread: boolean
  pinned: boolean
  state: 'current' | 'ready' | 'insufficient'
  should_generate: boolean
  show_generate_action: boolean
  detail_href: string
}

const DAY = 86_400_000

function dateKeyInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function shift(key: string, days: number): string {
  const value = new Date(`${key}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function mondayOf(key: string): string {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay()
  return shift(key, -((day + 6) % 7))
}

function monthOf(key: string): string {
  return `${key.slice(0, 7)}-01`
}

function monthEnd(monthStart: string): string {
  const value = new Date(`${monthStart}T00:00:00Z`)
  value.setUTCMonth(value.getUTCMonth() + 1)
  value.setUTCDate(0)
  return value.toISOString().slice(0, 10)
}

function previousMonth(monthStart: string): string {
  const value = new Date(`${monthStart}T00:00:00Z`)
  value.setUTCMonth(value.getUTCMonth() - 1)
  return value.toISOString().slice(0, 10)
}

function ageDays(today: string, ended: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ended}T00:00:00Z`)) / DAY)
}

const threshold: Record<ReviewTier, number> = { day: 1, week: 3, month: 10 }
const priority: Record<ReviewTier, number> = { day: 1, week: 2, month: 3 }

/** Pure C1 policy: calendar boundaries are derived in the user's time zone. */
export function computeReviewFeed(input: {
  now: Date
  timeZone: string
  settings: ReviewSettings
  reads: Array<{ tier: ReviewTier; period_start: string }>
  availability: ReviewAvailability[]
}): ReviewFeedItem[] {
  const today = dateKeyInZone(input.now, input.timeZone)
  const thisWeek = mondayOf(today)
  const thisMonth = monthOf(today)
  const previousWeek = shift(thisWeek, -7)
  const lastMonth = previousMonth(thisMonth)
  const reads = new Set(input.reads.map((read) => `${read.tier}:${read.period_start}`))
  const available = new Map(input.availability.map((item) => [`${item.tier}:${item.period_start}`, item]))
  const candidates: Array<{ tier: ReviewTier; start: string; end: string; current: boolean }> = []
  if (input.settings.day_enabled) candidates.push({ tier: 'day', start: today, end: today, current: false })
  if (input.settings.week_enabled) {
    candidates.push({ tier: 'week', start: thisWeek, end: shift(thisWeek, 6), current: true })
    candidates.push({ tier: 'week', start: previousWeek, end: shift(previousWeek, 6), current: false })
  }
  if (input.settings.month_enabled) {
    candidates.push({ tier: 'month', start: thisMonth, end: monthEnd(thisMonth), current: true })
    candidates.push({ tier: 'month', start: lastMonth, end: monthEnd(lastMonth), current: false })
  }

  const items = candidates.map((candidate): ReviewFeedItem => {
    const basis = available.get(`${candidate.tier}:${candidate.start}`) ?? {
      tier: candidate.tier,
      period_start: candidate.start,
      record_days: 0,
      workout_count: 0,
      has_ai: false,
    }
    const unread = !reads.has(`${candidate.tier}:${candidate.start}`)
    const enough = basis.record_days >= threshold[candidate.tier]
    return {
      ...basis,
      period_end: candidate.end,
      current: candidate.current,
      unread,
      pinned: false,
      state: candidate.current ? 'current' : enough ? 'ready' : 'insufficient',
      should_generate: !candidate.current && enough && !basis.has_ai && input.settings.generation_mode === 'auto',
      show_generate_action: !candidate.current && enough && !basis.has_ai && input.settings.generation_mode === 'manual',
      detail_href: candidate.tier === 'day'
        ? `/history?date=${candidate.start}`
        : candidate.tier === 'week'
          ? `/weekly?week_start=${candidate.start}`
          : `/review?month_start=${candidate.start}`,
    }
  })

  const pinCandidates = items.filter((item) => {
    if (item.current || item.tier === 'day' || item.state === 'insufficient') return false
    if (input.settings.pin_mode === 'until_read') return item.unread
    const retention = item.tier === 'month' ? 7 : 3
    return ageDays(today, item.period_end) <= retention
  })
  const pinned = pinCandidates.sort((a, b) => priority[b.tier] - priority[a.tier])[0]
    ?? items.find((item) => item.tier === 'day')
  if (pinned) pinned.pinned = true

  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.current !== b.current) return a.current ? -1 : 1
    if (priority[a.tier] !== priority[b.tier]) return priority[b.tier] - priority[a.tier]
    return b.period_start.localeCompare(a.period_start)
  })
}
