import { describe, expect, it } from 'vitest'
import {
  buildNutritionTargetSnapshot,
  targetSnapshotRpcArgs,
} from '../../lib/nutrition/targets.ts'

describe('versioned nutrition target snapshot', () => {
  it('preserves an unset calorie target as missing with full provenance', () => {
    const snapshot = buildNutritionTargetSnapshot({
      dailyCalorieTargetKcal: null,
      weightKg: 70,
    })
    expect(snapshot.source).toBe('missing')
    expect(snapshot.macroTargetStatus).toBe('insufficient_data')
    expect(snapshot.target).toEqual({
      calories_kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    })
    expect(snapshot.calculationBasis.reason).toBe('missing_calorie_target')
    expect(snapshot.evidenceRefIds.length).toBeGreaterThan(0)
  })

  it('persists the exact deterministic generator output and version', () => {
    const snapshot = buildNutritionTargetSnapshot({
      dailyCalorieTargetKcal: 2000,
      weightKg: 70,
    })
    expect(snapshot.source).toBe('user_target')
    expect(snapshot.macroTargetStatus).toBe('ok')
    expect(snapshot.target).toEqual({
      calories_kcal: 2000,
      protein_g: 112,
      carbs_g: 263,
      fat_g: 55.6,
    })
    expect(snapshot.calculationBasis.formula_version).toBe('pawside_macro_v1')

    expect(targetSnapshotRpcArgs(snapshot, '2026-09-26')).toMatchObject({
      p_target_effective_date: '2026-09-26',
      p_calorie_target_kcal: 2000,
      p_macro_target_status: 'ok',
      p_target_source: 'user_target',
    })
  })

  it('keeps incompatible macro allocation explicit', () => {
    const snapshot = buildNutritionTargetSnapshot({
      dailyCalorieTargetKcal: 500,
      weightKg: 200,
    })
    expect(snapshot.macroTargetStatus).toBe('needs_review')
    expect(snapshot.target.protein_g).toBeNull()
    expect(snapshot.calculationBasis.reason).toBe('carb_allocation_incompatible')
  })
})
