/**
 * Pawside — Macro recommendation generator.
 *
 * Authority chain (Guardrail §1.1 / §2.2 — every constant carries provenance):
 *   AI Patch §10    — input set: calorie target, weight, goal, training context
 *   AI Patch §11.1  — protein operational point, Evidence D
 *   AI Patch §12.1  — fat ratio + carb remainder, Evidence D
 *   AI Patch §12.2  — compatibility guardrail -> `needs_review`
 *
 * Definition of Done constraint (Guardrail §12.1): this module computes numbers;
 * it is not yet a product feature until a real caller persists/consumes them.
 * The onboarding UI is the first consumer.
 *
 * This module must remain the ONLY place these three formulas exist
 * (Guardrail §5 — single deterministic source). Do not re-derive macro targets
 * in a component, route, or prompt.
 */

// Source: AI Patch §12.1 — V1 operational default. Pawside operational target (Evidence D),
// positioned inside the ISSN 1.4–2.0 g/kg/day range and near the ~1.62 g/kg meta-analytic
// plateau. This is NOT a national or medical requirement.
export const PROTEIN_G_PER_KG = 1.6

// Source: AI Patch §12.1 — Pawside default selected as the midpoint of the
// guideline-compatible 20–30% fat energy range (Evidence D).
export const FAT_ENERGY_RATIO = 0.25

// Source: AI Patch §12.1 — energy per gram, standard Atwater factors.
export const KCAL_PER_G_PROTEIN = 4
export const KCAL_PER_G_CARB = 4
export const KCAL_PER_G_FAT = 9

export type MacroTargetStatus = 'ok' | 'needs_review' | 'insufficient_data'

export interface MacroRecommendedTargets {
  protein_g: number
  carb_g: number
  fat_g: number
}

export interface MacroTargetInput {
  /** User-set daily calorie target. `null` = not set (Product Patch §27). */
  dailyCalorieTargetKcal: number | null
  /**
   * Body weight in kg used for the protein coefficient.
   * Resolver precedence is decided in the Phase 0 map: latest body_metrics
   * weight -> user_profiles.weight_kg -> null.
   */
  weightKg: number | null
}

export interface MacroTargetResult {
  status: MacroTargetStatus
  /** Present only when `status === 'ok'`. */
  recommended: MacroRecommendedTargets | null
  /** Persisted alongside the targets (AI Patch §12.1: "必须把 calculation_basis 保存下来"). */
  calculationBasis: {
    formula_version: 'pawside_macro_v1'
    daily_calorie_target_kcal: number | null
    weight_kg: number | null
    protein_g_per_kg: number
    fat_energy_ratio: number
    /** Machine-readable reason when the result is not `ok`. */
    reason: string | null
  }
  /** Evidence references for the Evidence `?` surface (Product Patch §25). */
  evidenceRefIds: string[]
}

/**
 * Sources cited for this derivation. `E-NUT-PROTEIN-OP` is the Pawside
 * operational point (Evidence D) rather than a guideline threshold, so UI copy
 * must use the Product Patch §25.2 "Pawside 自定义" wording.
 */
const EVIDENCE_REF_IDS = ['E-NUT-PROTEIN-OP', 'E-NUT-MACRO-DIST'] as const

export function computeMacroTargets(input: MacroTargetInput): MacroTargetResult {
  const { dailyCalorieTargetKcal, weightKg } = input

  const basis = (
    reason: string | null,
  ): MacroTargetResult['calculationBasis'] => ({
    formula_version: 'pawside_macro_v1',
    daily_calorie_target_kcal: dailyCalorieTargetKcal,
    weight_kg: weightKg,
    protein_g_per_kg: PROTEIN_G_PER_KG,
    fat_energy_ratio: FAT_ENERGY_RATIO,
    reason,
  })

  const notAssessable = (reason: string): MacroTargetResult => ({
    status: 'insufficient_data',
    recommended: null,
    calculationBasis: basis(reason),
    evidenceRefIds: [...EVIDENCE_REF_IDS],
  })

  // Guardrail §12: an absent weight is `not recorded`, never 0 and never a guess.
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) {
    return notAssessable('missing_weight')
  }
  if (
    dailyCalorieTargetKcal === null ||
    !Number.isFinite(dailyCalorieTargetKcal) ||
    dailyCalorieTargetKcal <= 0
  ) {
    // Product Patch §27: no target -> show consumed, never a fabricated target.
    return notAssessable('missing_calorie_target')
  }

  const proteinG = weightKg * PROTEIN_G_PER_KG
  const fatKcal = dailyCalorieTargetKcal * FAT_ENERGY_RATIO
  const fatG = fatKcal / KCAL_PER_G_FAT
  const remainingKcal =
    dailyCalorieTargetKcal - proteinG * KCAL_PER_G_PROTEIN - fatG * KCAL_PER_G_FAT
  const carbG = remainingKcal / KCAL_PER_G_CARB

  // Source: AI Patch §12.2 — if allocation is incompatible with the calorie
  // target, do not force a result. Return `needs_review` and let the Calorie
  // caution surface handle it (Product Patch §5).
  if (!Number.isFinite(carbG) || carbG < 0) {
    return {
      status: 'needs_review',
      recommended: null,
      calculationBasis: basis('carb_allocation_incompatible'),
      evidenceRefIds: [...EVIDENCE_REF_IDS],
    }
  }

  return {
    status: 'ok',
    recommended: {
      protein_g: round1(proteinG),
      carb_g: round1(carbG),
      fat_g: round1(fatG),
    },
    calculationBasis: basis(null),
    evidenceRefIds: [...EVIDENCE_REF_IDS],
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
