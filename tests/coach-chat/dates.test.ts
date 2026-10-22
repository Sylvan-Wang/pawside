import { describe, expect, it } from 'vitest'
import {
  describeDate,
  inferMealSlot,
  isLateNightAmbiguous,
  localHour,
  MAX_BACKFILL_DAYS,
  resolveDateRef,
  validTimeZone,
} from '../../lib/coach-chat/dates'

// 2026-10-22 14:30 in Asia/Singapore (UTC+8) = 06:30 UTC
const NOW = new Date('2026-10-22T06:30:00.000Z')
const SG = 'Asia/Singapore'

describe('time zone', () => {
  it('accepts real IANA names and refuses everything else (no silent UTC)', () => {
    expect(validTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(validTimeZone(' America/Los_Angeles ')).toBe('America/Los_Angeles')
    expect(validTimeZone('Mars/Olympus')).toBeNull()
    expect(validTimeZone('')).toBeNull()
    expect(validTimeZone(undefined)).toBeNull()
    expect(validTimeZone(42)).toBeNull()
    expect(validTimeZone('x'.repeat(101))).toBeNull()
  })

  it('reads the local hour in the user zone, not the server zone', () => {
    expect(localHour(NOW, SG)).toBe(14)
    expect(localHour(NOW, 'UTC')).toBe(6)
    expect(localHour(new Date('2026-10-22T16:30:00.000Z'), SG)).toBe(0)
  })
})

describe('relative and explicit dates', () => {
  it('computes today/yesterday from the server clock in the user zone', () => {
    expect(resolveDateRef('unspecified', null, SG, NOW)).toEqual({ ok: true, date: '2026-10-22', source: 'default' })
    expect(resolveDateRef('today', null, SG, NOW)).toEqual({ ok: true, date: '2026-10-22', source: 'relative' })
    expect(resolveDateRef('yesterday', null, SG, NOW)).toEqual({ ok: true, date: '2026-10-21', source: 'relative' })
    expect(resolveDateRef('day_before_yesterday', null, SG, NOW)).toEqual({ ok: true, date: '2026-10-20', source: 'relative' })
  })

  it('uses the user calendar day across a UTC date boundary', () => {
    // 00:30 on the 23rd in Singapore is still the 22nd in UTC.
    const lateNight = new Date('2026-10-22T16:30:00.000Z')
    expect(resolveDateRef('today', null, SG, lateNight).ok && (resolveDateRef('today', null, SG, lateNight) as { date: string }).date).toBe('2026-10-23')
    expect((resolveDateRef('yesterday', null, SG, lateNight) as { date: string }).date).toBe('2026-10-22')
    expect((resolveDateRef('today', null, 'UTC', lateNight) as { date: string }).date).toBe('2026-10-22')
  })

  it('crosses month and year boundaries by calendar arithmetic', () => {
    const newYear = new Date('2027-01-01T04:00:00.000Z')
    expect((resolveDateRef('yesterday', null, 'UTC', newYear) as { date: string }).date).toBe('2026-12-31')
    expect((resolveDateRef('day_before_yesterday', null, 'UTC', new Date('2026-03-01T12:00:00Z')) as { date: string }).date).toBe('2026-02-27')
  })

  it('validates a model-supplied explicit date instead of trusting it', () => {
    expect(resolveDateRef('explicit', '2026-10-03', SG, NOW)).toEqual({ ok: true, date: '2026-10-03', source: 'explicit' })
    expect(resolveDateRef('explicit', '2026-02-30', SG, NOW)).toEqual({ ok: false, reason: 'invalid_date' })
    expect(resolveDateRef('explicit', '10月3号', SG, NOW)).toEqual({ ok: false, reason: 'invalid_date' })
    expect(resolveDateRef('explicit', null, SG, NOW)).toEqual({ ok: false, reason: 'invalid_date' })
    expect(resolveDateRef('explicit', '2026-10-23', SG, NOW)).toEqual({ ok: false, reason: 'future_date' })
    expect(resolveDateRef('explicit', '2026-10-22', SG, NOW).ok).toBe(true)
  })

  it('refuses dates older than the backfill window', () => {
    const oldest = new Date(Date.UTC(2026, 9, 22) - MAX_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10)
    expect(resolveDateRef('explicit', oldest, SG, NOW).ok).toBe(true)
    const tooOld = new Date(Date.UTC(2026, 9, 22) - (MAX_BACKFILL_DAYS + 1) * 86_400_000).toISOString().slice(0, 10)
    expect(resolveDateRef('explicit', tooOld, SG, NOW)).toEqual({ ok: false, reason: 'too_old' })
  })
})

describe('meal slot guess and late-night ambiguity', () => {
  it('guesses a slot from the clock', () => {
    expect([5, 9].map(inferMealSlot)).toEqual(['breakfast', 'breakfast'])
    expect([10, 13].map(inferMealSlot)).toEqual(['lunch', 'lunch'])
    expect([14, 16].map(inferMealSlot)).toEqual(['snack', 'snack'])
    expect([17, 21].map(inferMealSlot)).toEqual(['dinner', 'dinner'])
    expect([22, 0, 3].map(inferMealSlot)).toEqual(['snack', 'snack', 'snack'])
  })

  it('only asks about the date for an undated dinner/snack in the small hours', () => {
    expect(isLateNightAmbiguous({ meal: 'dinner', dateSource: 'default', hour: 1 })).toBe(true)
    expect(isLateNightAmbiguous({ meal: 'snack', dateSource: 'default', hour: 4 })).toBe(true)
    expect(isLateNightAmbiguous({ meal: 'dinner', dateSource: 'default', hour: 5 })).toBe(false)
    expect(isLateNightAmbiguous({ meal: 'dinner', dateSource: 'relative', hour: 1 })).toBe(false) // user said 昨天/今天
    expect(isLateNightAmbiguous({ meal: 'lunch', dateSource: 'default', hour: 1 })).toBe(false)
    expect(isLateNightAmbiguous({ meal: null, dateSource: 'default', hour: 1 })).toBe(false) // a guessed slot is not a user claim
  })

  it('labels dates for the user', () => {
    expect(describeDate('2026-10-22', '2026-10-22')).toBe('今天')
    expect(describeDate('2026-10-21', '2026-10-22')).toBe('昨天')
    expect(describeDate('2026-10-20', '2026-10-22')).toBe('前天')
    expect(describeDate('2026-10-03', '2026-10-22')).toBe('10月3日')
  })
})
