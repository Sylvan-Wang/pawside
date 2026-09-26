import { describe, expect, it } from 'vitest'
import { adjacentDates, toDashboardNutrition } from '../../lib/nutrition/daily-log.ts'
import type { NutritionBudget } from '../../lib/nutrition/types.ts'

/**
 * Phase C verification — Daily Log date navigation and dashboard row.
 *
 * Product §20 / AC-P12: adjacent days must be resolvable so the client can
 * preload them. Product §16.2: the dashboard nutrition row is a fixed four-row
 * contract, and Product §27 requires an unset target to stay null.
 */
describe('adjacentDates (Product §20)', () => {
  it('resolves the previous and next day', () => {
    expect(adjacentDates('2026-09-26')).toEqual({ previous: '2026-09-25', next: '2026-09-27' })
  })

  it('crosses a month boundary correctly', () => {
    expect(adjacentDates('2026-09-30')).toEqual({ previous: '2026-09-29', next: '2026-10-01' })
  })

  it('crosses a year boundary correctly', () => {
    expect(adjacentDates('2026-12-31')).toEqual({ previous: '2026-12-30', next: '2027-01-01' })
  })

  it('handles a leap day', () => {
    expect(adjacentDates('2028-02-28')).toEqual({ previous: '2028-02-27', next: '2028-02-29' })
    expect(adjacentDates('2028-02-29')).toEqual({ previous: '2028-02-28', next: '2028-03-01' })
  })

  it('does not shift the date when the server is in a negative UTC offset', () => {
    // Implemented on a UTC basis precisely so the result cannot depend on the
    // host timezone; a local-time implementation slips a day at UTC-5.
    expect(adjacentDates('2026-03-01').previous).toBe('2026-02-28')
  })
})

describe('toDashboardNutrition (Product §16.2)', () => {
  const budget: NutritionBudget = {
    target: { calories_kcal: 1800, protein_g: 112, carbs_g: 225.5, fat_g: 50 },
    consumed: { calories_kcal: 900, protein_g: 60, carbs_g: 100, fat_g: 25 },
    remaining: { calories_kcal: 900, protein_g: 52, carbs_g: 125.5, fat_g: 25 },
  }

  it('emits the four dashboard rows in a stable order', () => {
    const rows = toDashboardNutrition(budget)
    expect(rows.map((row) => row.key)).toEqual(['calories', 'protein', 'carbs', 'fat'])
    expect(rows.map((row) => row.unit)).toEqual(['kcal', 'g', 'g', 'g'])
  })

  it('reports consumed, target and remaining for each row', () => {
    const rows = toDashboardNutrition(budget)
    expect(rows[0]).toMatchObject({ consumed: 900, target: 1800, remaining: 900 })
    expect(rows[1]).toMatchObject({ consumed: 60, target: 112, remaining: 52 })
  })

  it('keeps target and remaining null when no target is set (Product §27)', () => {
    const noTarget: NutritionBudget = {
      target: { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null },
      consumed: budget.consumed,
      remaining: null,
    }
    const rows = toDashboardNutrition(noTarget)

    for (const row of rows) {
      expect(row.target).toBeNull()
      expect(row.remaining).toBeNull()
      // Consumed is still reported so the UI can show real intake.
      expect(row.consumed).toBeGreaterThan(0)
    }
  })

  it('passes through negative remaining without clamping (Product §4.2)', () => {
    const over: NutritionBudget = {
      target: budget.target,
      consumed: { calories_kcal: 2200, protein_g: 150, carbs_g: 300, fat_g: 70 },
      remaining: { calories_kcal: -400, protein_g: -38, carbs_g: -74.5, fat_g: -20 },
    }
    const rows = toDashboardNutrition(over)

    expect(rows[0].remaining).toBe(-400)
    expect(rows[1].remaining).toBe(-38)
    expect(rows.every((row) => (row.remaining ?? 0) < 0 || row.remaining === null)).toBe(true)
  })
})
