import type { MessageKey } from './index'

/**
 * 「今日营养进度」每行下面那句提示，对应 lib/nutrition/guidance.ts 的 describeRemaining。
 * 只是显示：数值保留一位小数（和原函数同样的取整），不参与任何营养计算。
 */
export function remainingParams(
  value: number | null,
  unit: string,
): { key: MessageKey; params?: Record<string, string | number> } {
  if (value === null) return { key: 'food.remaining.none' }
  const n = Math.round(Math.abs(value) * 10) / 10
  return { key: value < 0 ? 'food.remaining.over' : 'food.remaining.left', params: { n, unit } }
}
