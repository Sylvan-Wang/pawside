import { formatNumber } from '../coach/display'
import { describeDate } from './dates'
import type { DayFacts } from './day-facts'
import { MEAL_LABELS } from './meal'
import type { QueryAspect } from './schemas'
import type { DraftRow, MealDraftPayload, WeightDraftPayload, WorkoutDraftPayload } from './types'

/**
 * Assistant text the server writes itself. Anything involving a number, a date,
 * or a claim that something was saved is composed here from verified data, not
 * by the model (Patch §4 / §9). The model contributes only number-free
 * conversation text (replies.ts never trusts it for facts).
 */

export const TEXT = {
  introCapabilities: '我可以帮你记饮食、运动和体重，也可以告诉你某一天吃了什么、练了什么。直接说就行，比如「中午吃了一碗米饭和宫保鸡丁」。',
  noPlan: '我没太听明白你想记什么。可以说说吃了什么、做了什么运动，或者体重是多少吗？',
  needsFoodWhat: '吃了什么呢？说个大概就行。',
  needsWorkoutMinutes: '大概做了多久呢？',
  weightOutOfRange: '这个体重看起来不太对，可以再说一次吗？',
  confirmByButton: '点卡片上的「确认保存」就会记下来；我这边不会直接保存。',
  nothingToCancel: '现在没有等你确认的卡片。',
  dateInvalid: '这个日期我没看懂，可以换种说法吗？比如「昨天」或者「10月3号」。',
  dateFuture: '还没到的日子不能记录哦。如果是计划，等做完再告诉我。',
  dateTooOld: '太早的日子请到饮食或运动页面手动补记。',
  budgetExhausted: '这条我先不记了，信息还差一点。想好了随时再告诉我。',
  aiUnavailable: '我这会儿有点转不过来。你可以直接去饮食或运动页面记录，稍后再来找我。',
  rateLimited: '今天聊得有点多啦，明天再来找我，或者先去页面里手动记录。',
  disabled: '小爪暂时没有对你开放。',
  featureOff: '这部分功能暂时关闭了，先到对应的页面里手动记录吧。',
  tooLong: '这句话有点长，可以拆成几句再说吗？',
  duplicateOpen: '上一张卡片还没确认，已经替你换成新的了。',
  medical: '这类问题需要问医生或营养师。我可以继续帮你记录饮食和训练。',
  finance: '理财我帮不上忙。饮食、运动和体重记录我可以帮你。',
  other: '这个我帮不上忙。饮食、运动和体重记录我可以帮你。',
  smalltalk: '我在。想记点什么，或者看看今天吃了练了什么，直接说。',
  consultFallback: '想吃就吃，记得告诉我，我帮你记下来。',
} as const

export function proposeMealText(payload: MealDraftPayload, supersededOld: boolean): string {
  const unknown = payload.totals.unknown_item_count
  const parts = [`帮你整理了${MEAL_LABELS[payload.meal_type]}，看看对不对，确认后才会保存。`]
  if (unknown > 0) parts.push(`有 ${unknown} 项暂时算不出营养，先只记录吃了什么，之后可以补。`)
  if (supersededOld) parts.push('旧的那张已经作废。')
  return parts.join('')
}

export function proposeEditText(applied: string[], unmatched: string[]): string {
  const parts: string[] = []
  if (applied.length > 0) parts.push(`按你说的改了：${applied.join('；')}。确认后才会保存。`)
  if (unmatched.length > 0) parts.push(`这几处我没改成：${unmatched.join('；')}。`)
  return parts.join('') || TEXT.noPlan
}

export function proposeWorkoutText(payload: WorkoutDraftPayload): string {
  return payload.possible_duplicates.length > 0
    ? '先看看这条运动，今天好像已经有类似的记录了，确认前请核对。'
    : '运动整理好了，确认后才会保存。'
}

export function proposeWeightText(payload: WeightDraftPayload): string {
  return payload.replaces_kg !== null ? '体重整理好了，确认后会更新当天已有的体重。' : '体重整理好了，确认后才会保存。'
}

/** Short, non-judging line after a save (Patch §9). Only says what the record is. */
export function savedText(draft: DraftRow): string {
  if (draft.kind === 'workout') return '运动已记下。'
  if (draft.kind === 'weight') return '体重已记下。'
  const payload = draft.payload as MealDraftPayload
  const label = MEAL_LABELS[payload.meal_type]
  const unknown = payload.totals.unknown_item_count
  const estimated = payload.totals.estimated_item_count
  if (draft.kind === 'meal_edit') return `${label}已更新。`
  if (unknown > 0) return `${label}已记下，有 ${unknown} 项营养待补，之后可以补上。`
  if (estimated > 0) return `${label}已记下，份量是估算，可随时改。`
  return `${label}已记下。`
}

export function conflictText(kind: 'meal' | 'edited'): string {
  return kind === 'edited'
    ? '这餐刚刚在别处被改过了，我没有覆盖它。请再说一遍你想怎么改，我按最新的来。'
    : '这条没能保存。'
}

/** The day, in words. Facts only; no advice, no verdicts. */
export function dayFactsText(facts: DayFacts, today: string): string {
  const day = describeDate(facts.date, today)
  const lines: string[] = []
  const wants = (aspect: QueryAspect) => facts.aspects.includes(aspect)

  if (wants('meals')) {
    if (facts.meals.length === 0) {
      lines.push(`${day}还没有饮食记录。`)
    } else {
      const meals = facts.meals.map((meal) => {
        const label = MEAL_LABELS[meal.meal_type as keyof typeof MEAL_LABELS] ?? '加餐'
        const foods = meal.items.map((item) => item.name).join('、')
        return `${label}：${foods}`
      })
      lines.push(`${day}已记录：${meals.join('；')}。`)
    }
  }

  if (wants('nutrition') && facts.meals.length > 0) {
    const n = facts.nutrition
    if (n.known_kcal === null) {
      lines.push('这些记录还没有热量数据。')
    } else if (!n.complete) {
      lines.push(`已知热量约 ${formatNumber(n.known_kcal, 'kcal')} kcal，另有 ${n.unknown_item_count} 项营养待补，所以现在还不能算剩余。`)
    } else if (n.target_kcal !== null && n.remaining_kcal !== null) {
      const diff = n.remaining_kcal
      lines.push(`已记录约 ${formatNumber(n.known_kcal, 'kcal')} kcal，你的热量目标是 ${formatNumber(n.target_kcal, 'kcal')} kcal，${diff >= 0 ? `按已记录的算还差 ${formatNumber(diff, 'kcal')} kcal` : `已记录的比目标多 ${formatNumber(-diff, 'kcal')} kcal`}。`)
      lines.push('这只是目前已记录的部分，可能还有没记的。')
    } else {
      lines.push(`已记录约 ${formatNumber(n.known_kcal, 'kcal')} kcal（还没有设置热量目标）。`)
    }
  } else if (wants('nutrition') && !wants('meals') && facts.meals.length === 0) {
    lines.push(`${day}还没有饮食记录。`)
  }

  if (wants('workouts')) {
    if (facts.workouts.length === 0) {
      lines.push(`${day}没有运动记录。`)
    } else {
      const done = facts.workouts.map((w) => `${w.type}${w.duration_minutes ? ` ${w.duration_minutes} 分钟` : ''}`)
      lines.push(`${day}的运动：${done.join('；')}。`)
    }
    if (facts.unfinished_sessions > 0) lines.push('有一次训练已经开始但还没完成，不算作已完成。')
  }

  if (wants('weight')) {
    lines.push(facts.weight_kg === null ? `${day}没有体重记录。` : `${day}的体重：${formatNumber(facts.weight_kg, 'kg', 2)} kg。`)
  }

  return lines.join('\n')
}
