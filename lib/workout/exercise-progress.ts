/**
 * 按动作看重量走势（#48，方案见 docs/product/exercise-progress.md）。
 *
 * 纯函数：输入一个动作的历次正式组记录，输出每次训练的「最重一组 / 总次数 / 训练量」、
 * 逐组记录页「上次」那一行，和一句固定模板的总结。不用 AI，不算估算 1RM，不给训练建议。
 * 存储一律 kg；显示单位跟随逐组记录页的 kg / lb 选择，只换算显示，不改数据。
 */

import { kgToWeightInput, type TrainingWeightUnit } from '@/lib/training-weight-unit'
import { translate, type Locale } from '@/lib/i18n'

export type ProgressShape = 'weight_reps' | 'bodyweight_reps'

export interface ProgressSetInput {
  weightKg: number | null
  reps: number | null
  completed: boolean
  /** 计划外加的组（is_extra）不进走势。 */
  isExtra?: boolean
  /** 来自 set_prescriptions 的组类型；热身组不进走势。 */
  setType?: string | null
}

export interface ProgressSessionInput {
  sessionId: string
  /** 训练日期 YYYY-MM-DD（workout_sessions.log_date）。 */
  date: string
  sets: ProgressSetInput[]
}

export interface ProgressPoint {
  sessionId: string
  date: string
  /** 最重一组的重量（kg）；徒手动作为 null。 */
  topWeightKg: number | null
  /** 最重一组的次数（同重量取次数多的）；徒手动作是最多一组的次数。 */
  topReps: number
  totalReps: number
  /** Σ 重量 × 次数（kg）；徒手动作为 null。只在详情里小字显示。 */
  volumeKg: number | null
  /** 正式组的次数，按记录顺序；给「上次」那一行用。 */
  workingSets: Array<{ weightKg: number | null; reps: number }>
}

export type ProgressSummary =
  | { kind: 'single' }
  | { kind: 'heavier'; deltaKg: number; sinceDate: string; weeks: number | null }
  | { kind: 'more_reps'; weightKg: number | null; deltaReps: number; sinceDate: string }
  | { kind: 'flat'; sessions: number }
  | { kind: 'none' }

function isWorkingSet(set: ProgressSetInput, shape: ProgressShape): set is ProgressSetInput & { reps: number } {
  if (!set.completed || set.isExtra || set.setType === 'warmup') return false
  if (set.reps == null || !Number.isFinite(set.reps) || set.reps <= 0) return false
  if (shape === 'weight_reps') return set.weightKg != null && Number.isFinite(set.weightKg) && set.weightKg >= 0
  return true
}

/** 每次训练算一个点，按日期从旧到新；没有正式组的训练跳过。 */
export function buildProgressPoints(sessions: ProgressSessionInput[], shape: ProgressShape): ProgressPoint[] {
  const points: ProgressPoint[] = []
  for (const session of sessions) {
    const working = session.sets.filter(set => isWorkingSet(set, shape))
    if (working.length === 0) continue
    let topWeightKg: number | null = null
    let topReps = 0
    for (const set of working) {
      if (shape === 'weight_reps') {
        const w = set.weightKg as number
        if (topWeightKg === null || w > topWeightKg || (w === topWeightKg && set.reps > topReps)) {
          topWeightKg = w
          topReps = set.reps
        }
      } else if (set.reps > topReps) {
        topReps = set.reps
      }
    }
    const totalReps = working.reduce((sum, set) => sum + set.reps, 0)
    const volumeKg = shape === 'weight_reps'
      ? Math.round(working.reduce((sum, set) => sum + (set.weightKg as number) * set.reps, 0) * 10) / 10
      : null
    points.push({
      sessionId: session.sessionId,
      date: session.date,
      topWeightKg,
      topReps,
      totalReps,
      volumeKg,
      workingSets: working.map(set => ({ weightKg: shape === 'weight_reps' ? set.weightKg : null, reps: set.reps })),
    })
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

/** 逐组记录页的「上次」：今天之前最近一次（不含正在练的这次）。 */
export function lastPointBefore(points: ProgressPoint[], currentSessionId: string | null, today: string): ProgressPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    if (p.sessionId === currentSessionId) continue
    if (p.date > today) continue
    return p
  }
  return null
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * 一句话总结，只用固定模板（方案 4.2）：
 * 比 4 周前（不到 4 周就和第一次比）重了 → heavier；重量一样、次数多了 → more_reps；
 * 连续 3 次重量和次数都没涨 → flat（不给建议、不说「停滞」）；只有 1 次 → single。
 */
export function summarizeProgress(points: ProgressPoint[], shape: ProgressShape): ProgressSummary {
  if (points.length === 0) return { kind: 'none' }
  if (points.length === 1) return { kind: 'single' }
  const latest = points[points.length - 1]

  // 基准：最近一次往前 ≥ 28 天里最近的那次；没有就用第一次。
  let base = points[0]
  for (let i = points.length - 2; i >= 0; i--) {
    if (daysBetween(points[i].date, latest.date) >= 28) { base = points[i]; break }
  }
  const weeks = daysBetween(base.date, latest.date) >= 28 ? Math.round(daysBetween(base.date, latest.date) / 7) : null

  if (shape === 'weight_reps' && latest.topWeightKg !== null && base.topWeightKg !== null
    && latest.topWeightKg > base.topWeightKg) {
    return { kind: 'heavier', deltaKg: Math.round((latest.topWeightKg - base.topWeightKg) * 1000) / 1000, sinceDate: base.date, weeks }
  }
  if ((shape === 'bodyweight_reps' || latest.topWeightKg === base.topWeightKg) && latest.topReps > base.topReps) {
    return { kind: 'more_reps', weightKg: latest.topWeightKg, deltaReps: latest.topReps - base.topReps, sinceDate: base.date }
  }
  if (points.length >= 3) {
    const last3 = points.slice(-3)
    const flat = last3.every((p, i) => i === 0 || (
      (p.topWeightKg ?? 0) <= (last3[i - 1].topWeightKg ?? 0) && p.topReps <= last3[i - 1].topReps
    ))
    if (flat) return { kind: 'flat', sessions: 3 }
  }
  return { kind: 'none' }
}

function shortDate(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

/**
 * 「上次 11/12：40 kg × 8, 8, 7」。各组重量相同时合并写；不同时逐组写「40×8, 42.5×6」。
 */
export function formatLastTime(point: ProgressPoint, unit: TrainingWeightUnit, locale: Locale = 'zh'): string {
  const sets = point.workingSets
  const weights = sets.map(s => s.weightKg)
  let body: string
  if (weights.every(w => w === null)) {
    body = translate(locale, 'session.exercise.repsOnly', { reps: sets.map(s => s.reps).join(', ') })
  } else if (weights.every(w => w === weights[0])) {
    body = `${kgToWeightInput(weights[0], unit)} ${unit} × ${sets.map(s => s.reps).join(', ')}`
  } else {
    body = `${sets.map(s => `${kgToWeightInput(s.weightKg, unit)}×${s.reps}`).join(', ')} ${unit}`
  }
  return translate(locale, 'session.exercise.lastTime', { date: shortDate(point.date), body })
}

export function formatSummary(summary: ProgressSummary, unit: TrainingWeightUnit): string | null {
  switch (summary.kind) {
    case 'single': return '练两次以上就能看到走势'
    case 'heavier': {
      const since = summary.weeks ? ` ${summary.weeks} 周前 ` : `第一次（${shortDate(summary.sinceDate)}）`
      return `比${since}+${kgToWeightInput(summary.deltaKg, unit)} ${unit}`
    }
    case 'more_reps': return summary.weightKg === null
      ? `比 ${shortDate(summary.sinceDate)} 多做了 ${summary.deltaReps} 次`
      : `同样 ${kgToWeightInput(summary.weightKg, unit)} ${unit}，多做了 ${summary.deltaReps} 次`
    case 'flat': return '最近 3 次持平'
    case 'none': return null
  }
}
