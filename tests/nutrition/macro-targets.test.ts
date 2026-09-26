import { describe, expect, it } from 'vitest'
import {
  FAT_ENERGY_RATIO,
  KCAL_PER_G_CARB,
  KCAL_PER_G_FAT,
  KCAL_PER_G_PROTEIN,
  PROTEIN_G_PER_KG,
  computeMacroTargets,
} from '../../lib/nutrition/macro-targets.ts'

/**
 * Phase 0 verification — macro recommendation generator.
 *
 * Authority: AI Patch §12.1 (formulas), §12.2 (compatibility guardrail).
 * Guardrail §11 requires the boundary and invalid cases, not just the happy path.
 * Guardrail §12 requires `0` / missing / not-assessable to stay distinguishable.
 */
describe('macro target generator (AI Patch §12.1)', () => {
  it('uses the documented constants', () => {
    // These are Evidence D operational points, not guideline thresholds.
    expect(PROTEIN_G_PER_KG).toBe(1.6)
    expect(FAT_ENERGY_RATIO).toBe(0.25)
    expect(KCAL_PER_G_PROTEIN).toBe(4)
    expect(KCAL_PER_G_CARB).toBe(4)
    expect(KCAL_PER_G_FAT).toBe(9)
  })

  it('derives protein = weight x 1.6, fat = target x 0.25 / 9, carb = remainder / 4', () => {
    const result = computeMacroTargets({
      dailyCalorieTargetKcal: 1800,
      weightKg: 70,
    })

    expect(result.status).toBe('ok')

    // 70 * 1.6 = 112
    expect(result.recommended?.protein_g).toBe(112)

    // 1800 * 0.25 = 450 kcal ; 450 / 9 = 50
    expect(result.recommended?.fat_g).toBe(50)

    // 1800 - 112*4 - 450 = 1800 - 448 - 450 = 902 ; 902 / 4 = 225.5
    expect(result.recommended?.carb_g).toBe(225.5)
  })

  it('keeps the macro split summing back to the calorie target', () => {
    const result = computeMacroTargets({ dailyCalorieTargetKcal: 2000, weightKg: 80 })

    const protein = result.recommended?.protein_g ?? 0
    const carb = result.recommended?.carb_g ?? 0
    const fat = result.recommended?.fat_g ?? 0
    const totalKcal = protein * 4 + carb * 4 + fat * 9

    // Rounding to 1 decimal must not drift more than a calorie or two.
    expect(Math.abs(totalKcal - 2000)).toBeLessThanOrEqual(2)
  })

  it('returns insufficient_data for a missing calorie target, never a default', () => {
    const result = computeMacroTargets({ dailyCalorieTargetKcal: null, weightKg: 70 })

    expect(result.status).toBe('insufficient_data')
    expect(result.recommended).toBeNull()
    expect(result.calculationBasis.reason).toBe('missing_calorie_target')
    // Guardrail §2.2 / §12: no 2000-style substitution may appear.
    expect(result.calculationBasis.daily_calorie_target_kcal).toBeNull()
  })

  it('returns insufficient_data for a missing weight, never 0', () => {
    const result = computeMacroTargets({ dailyCalorieTargetKcal: 1800, weightKg: null })

    expect(result.status).toBe('insufficient_data')
    expect(result.recommended).toBeNull()
    expect(result.calculationBasis.reason).toBe('missing_weight')
    expect(result.calculationBasis.weight_kg).toBeNull()
  })

  it('treats zero and negative weight as not-recorded, not as a real value', () => {
    for (const weightKg of [0, -5]) {
      const result = computeMacroTargets({ dailyCalorieTargetKcal: 1800, weightKg })
      expect(result.status).toBe('insufficient_data')
      expect(result.calculationBasis.reason).toBe('missing_weight')
      expect(result.recommended).toBeNull()
    }
  })

  it('treats zero and negative calorie targets as not recorded', () => {
    for (const dailyCalorieTargetKcal of [0, -100]) {
      const result = computeMacroTargets({ dailyCalorieTargetKcal, weightKg: 70 })
      expect(result.status).toBe('insufficient_data')
      expect(result.calculationBasis.reason).toBe('missing_calorie_target')
    }
  })

  it('returns needs_review when the calorie target cannot carry the protein load', () => {
    // 70kg -> protein needs 112 * 4 = 448 kcal.
    // A 400 kcal target leaves 400 - 448 - 100 = -148 kcal for carbs.
    const result = computeMacroTargets({ dailyCalorieTargetKcal: 400, weightKg: 70 })

    expect(result.status).toBe('needs_review')
    expect(result.recommended).toBeNull()
    expect(result.calculationBasis.reason).toBe('carb_allocation_incompatible')
  })

  it('produces an exact zero carb remainder without erroring', () => {
    // Choose a target where remaining energy after protein+fat is exactly 0.
    // protein 70*1.6=112g -> 448 kcal ; fat = target*0.25 ; carb = 0
    // target - 448 - target*0.25 = 0  =>  target*0.75 = 448  =>  target = 597.33...
    const result = computeMacroTargets({
      dailyCalorieTargetKcal: 448 / 0.75,
      weightKg: 70,
    })

    expect(result.status).toBe('ok')
    expect(result.recommended?.carb_g).toBe(0)
  })

  it('preserves the calculation basis for provenance', () => {
    const result = computeMacroTargets({ dailyCalorieTargetKcal: 1800, weightKg: 70 })

    expect(result.calculationBasis.formula_version).toBe('pawside_macro_v1')
    expect(result.calculationBasis.daily_calorie_target_kcal).toBe(1800)
    expect(result.calculationBasis.weight_kg).toBe(70)
    expect(result.calculationBasis.protein_g_per_kg).toBe(1.6)
    expect(result.calculationBasis.fat_energy_ratio).toBe(0.25)
    expect(result.calculationBasis.reason).toBeNull()
  })

  it('always attaches evidence refs for the Evidence ? surface', () => {
    for (const input of [
      { dailyCalorieTargetKcal: 1800, weightKg: 70 },
      { dailyCalorieTargetKcal: null, weightKg: 70 },
      { dailyCalorieTargetKcal: 400, weightKg: 70 },
    ]) {
      const result = computeMacroTargets(input)
      // Product Patch §25 / AC-P14: every judgement must be explainable.
      expect(result.evidenceRefIds.length).toBeGreaterThan(0)
      // AI Patch §12.1: protein target is a Pawside operational point (Evidence D),
      // so it must never be attributed to a guideline.
      expect(result.evidenceRefIds).toContain('E-NUT-PROTEIN-OP')
    }
  })
})
