/**
 * Pawside — deterministic trend engine (Product §22–§24, AI Patch §29).
 *
 * Authority:
 *   AI Patch §29.1 — the trend CLASSIFICATION is computed by code, never eyeballed
 *                    by the LLM; the LLM only explains an already-decided trend
 *   AI Patch §21   — weight must be read as a rolling trend, not day-to-day noise
 *   Product §23.1  — do not fabricate a metric to fill the dashboard
 *   Product §27    — thin data yields "数据还不够", not a confident statement
 *
 * The AI must never be asked "is this increasing?" — it is told.
 */

export type TrendDirection =
  | 'increasing'
  | 'decreasing'
  | 'stable'
  | 'volatile'
  | 'insufficient'

export interface TrendResult {
  direction: TrendDirection
  /** Number of data points that actually carried a value. */
  point_count: number
  /** Mean of the points, or null when there is nothing to average. */
  mean: number | null
  /** First -> last change, or null when not computable. */
  change: number | null
  /** Machine-readable basis, so a `?` sheet can explain the classification. */
  basis: {
    method: 'first_last_with_volatility'
    /** Relative change threshold used to call something stable. */
    stable_band: number
    /** Normalised spread above which the series is called volatile. */
    volatility_band: number
    window: string
  }
  authority: string
}

/**
 * Classification bands.
 *
 * These are NOT health thresholds (AI Patch §14 style discipline): they are
 * descriptive statistics thresholds that decide whether to use the word
 * "stable" or "volatile". They carry no clinical meaning, and the wording they
 * gate is descriptive only ("本周体重基本稳定"), never a verdict.
 *
 * Source: Pawside heuristic, recorded here so it is auditable (Guardrail §2.2).
 */
export const TREND_BANDS = {
  /** |relative change| below this is called stable. */
  stable_band: 0.02,
  /** Normalised spread (range / mean) above this is called volatile. */
  volatility_band: 0.05,
  /** Fewer answered points than this is `insufficient` (Product §27). */
  min_points: 3,
} as const

export interface SeriesPoint {
  date: string
  value: number | null
}

/**
 * Product §27 / AC-P15: with too few points we must say "not enough data"
 * instead of picking a direction. Missing points are skipped, never treated as 0
 * (Guardrail §12) — a day with no weigh-in is not a 0 kg day.
 */
export function computeTrend(
  points: SeriesPoint[],
  window: string,
): TrendResult {
  const present = points.filter(
    (point): point is { date: string; value: number } =>
      point.value !== null && Number.isFinite(point.value),
  )

  const basis: TrendResult['basis'] = {
    method: 'first_last_with_volatility',
    stable_band: TREND_BANDS.stable_band,
    volatility_band: TREND_BANDS.volatility_band,
    window,
  }

  if (present.length < TREND_BANDS.min_points) {
    return {
      direction: 'insufficient',
      point_count: present.length,
      mean: null,
      change: null,
      basis,
      authority: 'Product Patch §27 / AC-P15',
    }
  }

  const values = present.map((point) => point.value)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const first = values[0]
  const last = values[values.length - 1]
  const change = last - first

  // A non-positive mean makes a relative comparison meaningless; fall back to
  // an absolute reading rather than dividing by zero.
  const relativeChange = mean === 0 ? 0 : Math.abs(change) / Math.abs(mean)
  const spread = Math.max(...values) - Math.min(...values)
  const normalisedSpread = mean === 0 ? 0 : spread / Math.abs(mean)

  if (normalisedSpread > TREND_BANDS.volatility_band) {
    return {
      direction: 'volatile',
      point_count: present.length,
      mean,
      change,
      basis,
      authority: 'AI Patch §29.1',
    }
  }

  if (relativeChange <= TREND_BANDS.stable_band) {
    return {
      direction: 'stable',
      point_count: present.length,
      mean,
      change,
      basis,
      authority: 'AI Patch §29.1',
    }
  }

  return {
    direction: change > 0 ? 'increasing' : 'decreasing',
    point_count: present.length,
    mean,
    change,
    basis,
    authority: 'AI Patch §29.1',
  }
}

/**
 * AI Patch §21: a single day's weight delta must not be presented as progress.
 * Returns the 7-day rolling mean instead, which is the correct comparison base.
 */
export function rollingAverage(
  points: SeriesPoint[],
  window = 7,
): SeriesPoint[] {
  const result: SeriesPoint[] = []
  for (let index = 0; index < points.length; index += 1) {
    const slice = points
      .slice(Math.max(0, index - window + 1), index + 1)
      .filter((point) => point.value !== null && Number.isFinite(point.value))
    const values = slice.map((point) => point.value as number)
    result.push({
      date: points[index].date,
      value: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
    })
  }
  return result
}

/** Human-readable, non-clinical description of a trend. */
export function describeTrend(direction: TrendDirection, subject: string): string | null {
  switch (direction) {
    case 'increasing':
      return `${subject}呈上升趋势`
    case 'decreasing':
      return `${subject}呈下降趋势`
    case 'stable':
      return `${subject}基本稳定`
    case 'volatile':
      return `${subject}波动较大`
    case 'insufficient':
      // Product §27: never let the UI or AI fill this in.
      return '数据还不够，继续记录后再判断趋势'
    default:
      return null
  }
}
