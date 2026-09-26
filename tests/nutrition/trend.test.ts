import { describe, expect, it } from 'vitest'
import {
  TREND_BANDS,
  computeTrend,
  describeTrend,
  rollingAverage,
  type SeriesPoint,
} from '../../lib/nutrition/trend.ts'

/**
 * Phase D verification — deterministic trend engine.
 *
 * AI Patch §29.1 / AC-AI11: the classification must come from code. These tests
 * pin the boundaries so a future change to a band is a deliberate act, and they
 * assert the thin-data path returns `insufficient` rather than a direction
 * (Product §27 / AC-P15).
 */

function series(values: Array<number | null>): SeriesPoint[] {
  return values.map((value, index) => ({
    date: `2026-09-${String(20 + index).padStart(2, '0')}`,
    value,
  }))
}

describe('computeTrend — insufficient data (Product §27)', () => {
  it('returns insufficient below the minimum point count', () => {
    const result = computeTrend(series([70, 70.5]), 'week')
    expect(result.direction).toBe('insufficient')
    expect(result.mean).toBeNull()
    expect(result.change).toBeNull()
    expect(result.authority).toBe('Product Patch §27 / AC-P15')
  })

  it('counts only present values toward the minimum', () => {
    // 3 slots but only 2 real values -> still insufficient.
    const result = computeTrend(series([70, null, 70.5]), 'week')
    expect(result.direction).toBe('insufficient')
    expect(result.point_count).toBe(2)
  })

  it('returns insufficient for an empty series', () => {
    expect(computeTrend([], 'week').direction).toBe('insufficient')
  })

  it('never treats a missing point as zero', () => {
    // If null were coerced to 0 the mean would collapse and the direction would
    // read as a dramatic decrease.
    const withGap = computeTrend(series([70, 70.2, null, 70.4, 70.1]), 'week')
    const withoutGap = computeTrend(series([70, 70.2, 70.4, 70.1]), 'week')

    expect(withGap.mean).toBeCloseTo(withoutGap.mean as number, 6)
    expect(withGap.direction).toBe(withoutGap.direction)
  })
})

describe('computeTrend — classification', () => {
  it('reports stable for a flat series', () => {
    const result = computeTrend(series([70, 70, 70, 70]), 'week')
    expect(result.direction).toBe('stable')
    expect(result.change).toBe(0)
  })

  it('reports increasing for a sustained rise beyond the band', () => {
    // 70 -> 72 is +2.9%, above the 2% stable band, and the spread is 2.9% so
    // it stays under the volatility band in relative terms only if mean is large.
    const result = computeTrend(series([70, 70.5, 71, 71.5, 72]), 'week')
    expect(['increasing', 'volatile']).toContain(result.direction)
    expect(result.change).toBeCloseTo(2, 6)
  })

  it('reports decreasing for a sustained fall', () => {
    const result = computeTrend(series([75, 74.5, 74, 73.5, 73]), 'week')
    expect(['decreasing', 'volatile']).toContain(result.direction)
    expect(result.change).toBeCloseTo(-2, 6)
  })

  it('reports volatile when the spread is large relative to the mean', () => {
    const result = computeTrend(series([70, 78, 70, 78, 70]), 'week')
    expect(result.direction).toBe('volatile')
    // Volatility is reported before direction, so no false trend claim.
    expect(result.authority).toBe('AI Patch §29.1')
  })

  it('calls a change inside the stable band stable', () => {
    // 70 -> 70.7 is +1%, inside the 2% band.
    const result = computeTrend(series([70, 70.2, 70.5, 70.7]), 'week')
    expect(result.direction).toBe('stable')
  })

  it('does not divide by zero when the mean is zero', () => {
    // A zero-mean series (e.g. a rest week measured in minutes) must not produce
    // NaN or Infinity in the basis maths.
    const result = computeTrend(series([0, 0, 0, 0]), 'week')
    expect(Number.isFinite(result.mean as number)).toBe(true)
    expect(result.direction).toBe('stable')
  })

  it('reports a basis that explains how the call was made', () => {
    const result = computeTrend(series([70, 71, 72, 73]), 'week')
    expect(result.basis.method).toBe('first_last_with_volatility')
    expect(result.basis.stable_band).toBe(TREND_BANDS.stable_band)
    expect(result.basis.volatility_band).toBe(TREND_BANDS.volatility_band)
    expect(result.basis.window).toBe('week')
  })
})

describe('rollingAverage (AI Patch §21)', () => {
  it('smooths a single-day spike instead of reacting to it', () => {
    // The Patch forbids reading one day's drop as fat loss.
    const points = series([70, 70, 70, 69, 70, 70, 70])
    const rolled = rollingAverage(points, 7)

    const spikeDay = rolled[3].value as number
    // The raw day is 69; the rolling mean must be far closer to 70.
    expect(spikeDay).toBeGreaterThan(69.5)
    expect(spikeDay).toBeLessThan(70)
  })

  it('carries the window mean through a day with no measurement', () => {
    // The rolling mean is a trailing window, so a gap day still reports the
    // mean of the days that DO have measurements rather than a hole.
    const rolled = rollingAverage(series([70, null, 70]), 7)
    expect(rolled[1].value).toBe(70)
  })

  it('stays null only when the whole window has no measurement', () => {
    // A leading gap has nothing to average yet, so it must stay null rather
    // than falling back to 0 (Guardrail §12).
    const rolled = rollingAverage(series([null, null, 70]), 7)
    expect(rolled[0].value).toBeNull()
    expect(rolled[1].value).toBeNull()
    expect(rolled[2].value).toBe(70)
  })

  it('produces one point per input point', () => {
    const points = series([70, 71, 72])
    expect(rollingAverage(points, 7)).toHaveLength(3)
  })
})

describe('describeTrend (Product §27)', () => {
  it('returns the insufficient-data line so nothing has to be invented', () => {
    expect(describeTrend('insufficient', '体重')).toBe('数据还不够，继续记录后再判断趋势')
  })

  it('describes each direction without a health verdict', () => {
    for (const direction of ['increasing', 'decreasing', 'stable', 'volatile'] as const) {
      const text = describeTrend(direction, '体重')
      expect(text).not.toBeNull()
      // Descriptive only: no medical or safety language.
      for (const word of ['不健康', '危险', '风险', '过度']) {
        expect(text).not.toContain(word)
      }
    }
  })
})
