import { describe, expect, it } from 'vitest'
import { computeReviewFeed, type ReviewSettings } from '../../lib/review/feed'

const defaults: ReviewSettings = { day_enabled: true, week_enabled: true, month_enabled: true, generation_mode: 'auto', pin_mode: 'until_read' }
const availability = [
  { tier: 'week' as const, period_start: '2026-09-28', record_days: 4, workout_count: 3 },
  { tier: 'month' as const, period_start: '2026-09-01', record_days: 15, workout_count: 10 },
]

describe('computeReviewFeed', () => {
  it('pins the daily review on an ordinary Wednesday', () => {
    const feed = computeReviewFeed({ now: new Date('2026-10-07T04:00:00Z'), timeZone: 'Asia/Shanghai', settings: defaults, reads: [], availability: [] })
    expect(feed[0]).toMatchObject({ tier: 'day', pinned: true })
    expect(feed.find((item) => item.tier === 'week' && item.current)).toMatchObject({ state: 'current' })
  })

  it('pins last week on Monday until it is read', () => {
    const base = { now: new Date('2026-10-05T04:00:00Z'), timeZone: 'Asia/Shanghai', settings: defaults, availability }
    const oldMonthRead = { tier: 'month' as const, period_start: '2026-09-01' }
    expect(computeReviewFeed({ ...base, reads: [oldMonthRead] })[0]).toMatchObject({ tier: 'week', period_start: '2026-09-28', unread: true })
    expect(computeReviewFeed({ ...base, reads: [oldMonthRead, { tier: 'week', period_start: '2026-09-28' }] })[0]).toMatchObject({ tier: 'day' })
  })

  it('orders month over week when both just ended', () => {
    const feed = computeReviewFeed({ now: new Date('2026-10-01T04:00:00Z'), timeZone: 'Asia/Shanghai', settings: defaults, reads: [], availability })
    expect(feed[0]).toMatchObject({ tier: 'month', period_start: '2026-09-01', pinned: true })
    expect(feed.findIndex((item) => item.tier === 'week' && !item.current)).toBeLessThan(feed.findIndex((item) => item.tier === 'day'))
  })

  it('honours disabled tiers, manual mode and thresholds', () => {
    const settings = { ...defaults, month_enabled: false, generation_mode: 'manual' as const }
    const feed = computeReviewFeed({ now: new Date('2026-10-05T04:00:00Z'), timeZone: 'Asia/Shanghai', settings, reads: [], availability: [{ tier: 'week', period_start: '2026-09-28', record_days: 2, workout_count: 1 }] })
    expect(feed.some((item) => item.tier === 'month')).toBe(false)
    expect(feed.find((item) => item.tier === 'week' && !item.current)).toMatchObject({ state: 'insufficient', should_generate: false, show_generate_action: false })
  })

  it('folds ended reviews after their retention windows', () => {
    const settings = { ...defaults, pin_mode: 'three_days' as const }
    const weekFeed = computeReviewFeed({ now: new Date('2026-10-09T04:00:00Z'), timeZone: 'Asia/Shanghai', settings, reads: [], availability })
    expect(weekFeed[0]).toMatchObject({ tier: 'day' })
    const monthFeed = computeReviewFeed({ now: new Date('2026-10-09T04:00:00Z'), timeZone: 'Asia/Shanghai', settings, reads: [], availability: [{ tier: 'month', period_start: '2026-09-01', record_days: 15, workout_count: 10 }] })
    expect(monthFeed[0]).toMatchObject({ tier: 'day' })
  })

  it('uses the user time zone at day boundaries', () => {
    const before = computeReviewFeed({ now: new Date('2026-10-04T15:59:00Z'), timeZone: 'Asia/Shanghai', settings: defaults, reads: [], availability: [] })
    const after = computeReviewFeed({ now: new Date('2026-10-04T16:01:00Z'), timeZone: 'Asia/Shanghai', settings: defaults, reads: [], availability: [] })
    expect(before.find((item) => item.tier === 'week' && item.current)?.period_start).toBe('2026-09-28')
    expect(after.find((item) => item.tier === 'week' && item.current)?.period_start).toBe('2026-10-05')
  })
})
