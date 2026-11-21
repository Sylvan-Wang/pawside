/**
 * Pawside — 把克数说成「人话」，并给出「差不多就算到位」的范围。
 *
 * 只是换一种说法，不参与任何计算，也不写进记录。数字都是约数：
 * - 一掌心瘦肉（生重约 100–120 g，手掌大小和厚度）约 20–30 g 蛋白质。
 *   来源：Precision Nutrition 手掌份量法（1 palm ≈ 20–30 g protein）；
 *   USDA FoodData Central 鸡胸肉（生）约 22.5 g/100 g、猪里脊约 21 g/100 g。
 *   这里取 25 g 作为换算点。
 * - 达标范围 ±10%：每天的记录本来就是估的（份量、做法、油），差一成以内
 *   不值得让用户再为它多想一步。这是 Pawside 的取舍（Evidence D），不是营养学标准。
 */

/** 一掌心瘦肉对应的蛋白质，取 20–30 g 的中点。 */
export const PROTEIN_G_PER_PALM = 25

/** 与目标相差在这个比例以内，就说「差不多到位」，不再报多了 / 少了多少。 */
export const ON_TARGET_TOLERANCE = 0.1

/** 蛋白质缺口小于这个数就不提：不到半掌心，不值得多一句话。 */
export const PROTEIN_GAP_MIN_G = 15

/** 与目标的差距是否在 ±10% 以内。目标无效时返回 false。 */
export function isWithinTolerance(actual: number, target: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return false
  return Math.abs(actual - target) <= target * ON_TARGET_TOLERANCE
}

/**
 * 蛋白质缺口换成掌心数。按半掌心取整，最多说到「两掌心」，再多就建议分到几顿，
 * 因为一顿吃三掌心肉既不现实，也不是我们想推的做法。
 * 缺口小于 PROTEIN_GAP_MIN_G 时返回 null。
 */
export function proteinGapInPalms(gapG: number): string | null {
  if (!Number.isFinite(gapG) || gapG < PROTEIN_GAP_MIN_G) return null
  const halves = Math.max(1, Math.round((gapG / PROTEIN_G_PER_PALM) * 2))
  if (halves <= 1) return '大约半掌心瘦肉'
  if (halves === 2) return '大约一掌心瘦肉'
  if (halves === 3) return '大约一掌心半瘦肉'
  if (halves === 4) return '大约两掌心瘦肉'
  return '超过两掌心瘦肉的量，可以分到接下来几顿'
}
