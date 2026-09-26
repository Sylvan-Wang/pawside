import { computeMacroTargets, type MacroTargetStatus } from './macro-targets'
import type { NutrientTargets } from './types'

export interface NutritionTargetSnapshot {
  target: NutrientTargets
  source: 'user_target' | 'missing'
  macroTargetStatus: MacroTargetStatus
  calculationBasis: ReturnType<typeof computeMacroTargets>['calculationBasis']
  evidenceRefIds: string[]
}

/**
 * Single deterministic adapter from profile/body inputs to the persisted
 * nutrition_targets contract. Components and SQL never reimplement formulas.
 */
export function buildNutritionTargetSnapshot(input: {
  dailyCalorieTargetKcal: number | null
  weightKg: number | null
}): NutritionTargetSnapshot {
  const macros = computeMacroTargets(input)
  return {
    target: {
      calories_kcal: input.dailyCalorieTargetKcal,
      protein_g: macros.recommended?.protein_g ?? null,
      carbs_g: macros.recommended?.carb_g ?? null,
      fat_g: macros.recommended?.fat_g ?? null,
    },
    source: input.dailyCalorieTargetKcal === null ? 'missing' : 'user_target',
    macroTargetStatus: macros.status,
    calculationBasis: macros.calculationBasis,
    evidenceRefIds: macros.evidenceRefIds,
  }
}

export function targetSnapshotRpcArgs(
  snapshot: NutritionTargetSnapshot,
  effectiveDate: string,
) {
  return {
    p_target_effective_date: effectiveDate,
    p_calorie_target_kcal: snapshot.target.calories_kcal,
    p_protein_target_g: snapshot.target.protein_g,
    p_carb_target_g: snapshot.target.carbs_g,
    p_fat_target_g: snapshot.target.fat_g,
    p_target_source: snapshot.source,
    p_macro_target_status: snapshot.macroTargetStatus,
    p_target_calculation_basis: snapshot.calculationBasis,
    p_target_evidence_ref_ids: snapshot.evidenceRefIds,
  }
}
