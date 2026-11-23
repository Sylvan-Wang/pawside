import type { PlannedSetGuidance, PlannedSetInput } from '@/lib/coach/set-guidance'
import { translate, type Locale, type MessageKey } from './index'

const SET_TYPES = ['warmup', 'working', 'failure', 'rest_pause', 'backoff', 'other']

/**
 * 逐组记录页每组的目标说明。中文原样返回 describePlannedSet 的结果（逐字不变）。
 * 英文只用组的结构化字段重写（组类型、次数、RIR / RPE、力竭标记）；
 * 方法数据里的中文备注（quality_requirement）在英文模式下不显示，等方法文案英文化再加。
 */
export function localizeSetGuidance(
  set: PlannedSetInput,
  guidance: PlannedSetGuidance,
  locale: Locale,
): PlannedSetGuidance {
  if (locale !== 'en') return guidance
  const type = set.set_type ?? 'working'
  const label = translate('en', `today.setTypes.${SET_TYPES.includes(type) ? type : 'other'}` as MessageKey)
  // describePlannedSet 的次数只有「12 次」「8–12 次」「10 + 5 次」三种写法。
  const target = guidance.target ? guidance.target.replace(/\s*次$/, guidance.target.trim() === '1 次' ? ' rep' : ' reps') : null

  let effort: string | null = null
  if (set.failure_required) effort = 'To failure'
  else if (set.target_rir != null) effort = `${set.target_rir} reps in reserve`
  else if (set.target_rpe != null) effort = `RPE ${set.target_rpe}`
  else if (set.failure_allowed) effort = type === 'rest_pause' || type === 'failure' ? 'Close to or at failure' : 'Can go close to failure'
  else if (type === 'warmup') effort = 'Keep it easy'
  else if (type === 'working') effort = 'Not to failure'

  return { label, target, effort, note: null, emphasis: guidance.emphasis }
}
