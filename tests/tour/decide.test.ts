import { describe, expect, it } from 'vitest'
import { decideTour, NEW_USER_DAYS, seenVersionFrom } from '@/lib/tour/decide'
import type { TourStep } from '@/lib/tour/steps'

const step = (id: string, since: number, launchedOn?: string): TourStep =>
  ({ id, since, launchedOn, mood: 'wave', title: id, body: id })
const STEPS = [step('a', 1), step('b', 1), step('new', 2, '2026-11-25')]
const now = new Date('2026-11-25T04:00:00Z') // 12:00 in Shanghai
const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
const base = { now, timeZone: 'Asia/Shanghai', steps: STEPS, version: 2 }

describe('who sees the tour', () => {
  it('shows everything to a brand-new account', () => {
    const d = decideTour({ ...base, seen: null, accountCreatedAt: days(0.1) })
    expect(d.steps.map((s) => s.id)).toEqual(['a', 'b', 'new'])
    expect(d.markSeenSilently).toBe(false)
  })

  it('shows nothing to an old account with no record of seeing it (cleared storage, new phone)', () => {
    const d = decideTour({ ...base, seen: null, accountCreatedAt: days(NEW_USER_DAYS + 1) })
    expect(d.steps).toEqual([])
    expect(d.markSeenSilently).toBe(true)
  })

  it('shows nothing when the signup time is unknown', () => {
    expect(decideTour({ ...base, seen: null, accountCreatedAt: null }).steps).toEqual([])
  })

  it('shows a returning user only what launched today', () => {
    const d = decideTour({ ...base, seen: 1, accountCreatedAt: days(60) })
    expect(d.steps.map((s) => s.id)).toEqual(['new'])
    expect(d.returning).toBe(true)
  })

  it('does not pop up the day after launch', () => {
    const d = decideTour({ ...base, now: new Date('2026-11-26T04:00:00Z'), seen: 1, accountCreatedAt: days(60) })
    expect(d.steps).toEqual([])
    expect(d.markSeenSilently).toBe(true)
  })

  it('uses the user’s own date for "today"', () => {
    // 2026-11-24 23:30 in Los Angeles is already 11-25 in Shanghai.
    const late = new Date('2026-11-25T07:30:00Z')
    expect(decideTour({ ...base, now: late, timeZone: 'America/Los_Angeles', seen: 1, accountCreatedAt: days(60) }).steps).toEqual([])
  })

  it('shows nothing once the current version is seen', () => {
    expect(decideTour({ ...base, seen: 2, accountCreatedAt: days(0) })).toEqual({ steps: [], returning: false, markSeenSilently: false })
  })
})

describe('seen version', () => {
  it('takes the newer of browser and account', () => {
    expect(seenVersionFrom(null, 1)).toBe(1)
    expect(seenVersionFrom(1, null)).toBe(1)
    expect(seenVersionFrom(1, 2)).toBe(2)
    expect(seenVersionFrom(null, 'x')).toBe(null)
  })
})
