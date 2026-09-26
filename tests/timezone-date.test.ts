import { describe, expect, it } from 'vitest'
import {
  dateKeyInTimeZone,
  getWeekStartKey,
  shiftDateKey,
} from '../lib/utils.ts'

describe('timezone-safe calendar dates', () => {
  it('keeps Singapore after-midnight records on the local day', () => {
    const instant = new Date('2026-09-27T16:30:00.000Z')
    expect(dateKeyInTimeZone(instant, 'Asia/Singapore')).toBe('2026-09-28')
    expect(dateKeyInTimeZone(instant, 'UTC')).toBe('2026-09-27')
  })

  it('starts the Singapore week on Monday rather than UTC Sunday', () => {
    const instant = new Date('2026-09-27T16:30:00.000Z')
    expect(getWeekStartKey(instant, 'Asia/Singapore')).toBe('2026-09-28')
  })

  it('uses calendar arithmetic across month and year boundaries', () => {
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDateKey('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('rejects invalid timezone names instead of silently falling back', () => {
    expect(() => dateKeyInTimeZone(new Date(), 'Mars/Olympus')).toThrow()
  })
})
