import { formatNumber } from '../coach/display'
import { describeDate } from './dates'
import { MEAL_LABELS } from './meal'
import type {
  CardLine,
  CardView,
  ClarifyPayload,
  DraftRow,
  MealDraftItem,
  MealDraftPayload,
  WeightDraftPayload,
  WorkoutDraftPayload,
} from './types'

/**
 * Card text, built on the server from the stored draft. Every number here comes
 * from the draft (which comes from deterministic code); none is typed by the
 * model. The browser only displays this and sends back "confirm draft X".
 */

const WARNING_TEXT: Record<string, string> = {
  estimate_unavailable: 'AI 暂时算不出营养，这几样先只记录吃了什么。',
  food_lookup_failed: '食物库暂时查不了，营养先不算。',
  some_items_without_weight: '没有记过重量的食物没有被调整。',
}

function kcal(value: number | null): string | null {
  return value === null ? null : `${formatNumber(value, 'kcal')} kcal`
}

function mealItemLine(item: MealDraftItem): CardLine {
  const parts: string[] = [item.name_raw]
  if (item.amount_text) parts.push(item.amount_text)
  if (item.weight_g !== null) {
    const approx = item.weight_basis === 'user_grams' || item.weight_basis === 'unit_conversion' || item.weight_basis === 'kept'
      ? ''
      : '约'
    parts.push(`${approx}${formatNumber(item.weight_g, 'g')}g`)
  }
  if (item.nutrition) parts.push(kcal(item.nutrition.energy_kcal) as string)
  let badge: string | null = null
  if (item.nutrition_status === 'unknown') badge = '营养待补'
  else if (item.nutrition_status === 'estimated') badge = '估算'
  return { text: parts.join(' · '), badge }
}

function mealTotal(payload: MealDraftPayload): string | null {
  const { known, unknown_item_count: unknown, item_count: count } = payload.totals
  if (known.energy_kcal === null) return count > 0 ? '营养待补（先只记录吃了什么）' : null
  const bits = [`已知合计 ${kcal(known.energy_kcal)}`]
  if (known.protein_g !== null) bits.push(`蛋白质 ${formatNumber(known.protein_g, 'g')}g`)
  if (unknown > 0) bits.push(`另有 ${unknown} 项营养待补`)
  return bits.join(' · ')
}

function mealCard(draft: DraftRow, today: string): Pick<CardView, 'title' | 'subtitle' | 'lines' | 'total' | 'notes'> {
  const payload = draft.payload as MealDraftPayload
  const isEdit = draft.kind === 'meal_edit'
  const when = describeDate(payload.date, today)
  const notes: string[] = []
  if (isEdit && payload.before) notes.push(`原来：${payload.before.summary}`)
  for (const item of payload.items) if (item.caveat) notes.push(`${item.name_raw}：${item.caveat}`)
  for (const warning of payload.warnings) if (WARNING_TEXT[warning]) notes.push(WARNING_TEXT[warning])
  if (payload.totals.estimated_item_count > 0) notes.push('带「估算」的份量或营养是估的，随时可以改。')

  return {
    title: `${isEdit ? '修改' : ''}${MEAL_LABELS[payload.meal_type]}（${when}）`,
    subtitle: payload.meal_type_source === 'inferred' ? '餐别是按时间推测的，不对请告诉我。' : null,
    lines: payload.items.map(mealItemLine),
    total: mealTotal(payload),
    notes: [...new Set(notes)],
  }
}

function workoutCard(draft: DraftRow, today: string): Pick<CardView, 'title' | 'subtitle' | 'lines' | 'total' | 'notes'> {
  const payload = draft.payload as WorkoutDraftPayload
  const notes: string[] = []
  if (payload.calories !== null) notes.push(`消耗热量 ${kcal(payload.calories)} 是你提供的。`)
  if (payload.notes) notes.push(payload.notes)
  if (payload.possible_duplicates.length > 0) {
    notes.push(`看起来今天已经有：${payload.possible_duplicates.map((d) => d.label).join('；')}。如果是同一次，请不要保存。`)
  }
  return {
    title: `运动（${describeDate(payload.date, today)}）`,
    subtitle: null,
    lines: [{ text: `${payload.workout_type} · ${payload.minutes} 分钟`, badge: null }],
    total: null,
    notes,
  }
}

function weightCard(draft: DraftRow, today: string): Pick<CardView, 'title' | 'subtitle' | 'lines' | 'total' | 'notes'> {
  const payload = draft.payload as WeightDraftPayload
  const unitLabel = payload.shown_unit === 'jin' ? '斤' : payload.shown_unit
  const notes: string[] = []
  if (payload.shown_unit !== 'kg') notes.push(`换算为 ${formatNumber(payload.weight_kg, 'kg', 2)} kg 记录。`)
  if (payload.unit_source === 'profile') notes.push(`你没说单位，按你设置的 ${unitLabel} 记，不对请告诉我。`)
  if (payload.replaces_kg !== null) {
    notes.push(`会更新当天已有的体重（${formatNumber(payload.replaces_kg, 'kg', 2)} kg），当天的其他身体数据不变。`)
  }
  return {
    title: `体重（${describeDate(payload.date, today)}）`,
    subtitle: null,
    lines: [{ text: `${formatNumber(payload.shown_value, undefined, 2)} ${unitLabel}`, badge: null }],
    total: null,
    notes,
  }
}

const STATUS_TEXT: Partial<Record<DraftRow['status'], string>> = {
  saved: '已保存',
  superseded: '已被新的版本取代',
  cancelled: '已取消',
  committing: '保存中…',
  failed: '没能保存。可以再说一遍，或到饮食/运动页手动记录。',
  outcome_unknown: '不确定有没有保存成功。点「再试一次」，会先核对，不会重复记录。',
  needs_clarification: '等你回答上面的问题。',
}

export function isExpired(draft: Pick<DraftRow, 'expires_at'>, now: Date): boolean {
  return new Date(draft.expires_at).getTime() <= now.getTime()
}

function clarifyBody(draft: DraftRow): Pick<CardView, 'title' | 'subtitle' | 'lines' | 'total' | 'notes'> {
  void draft
  return { title: '等你回答', subtitle: null, lines: [], total: null, notes: [] }
}

export function buildCard(draft: DraftRow, now: Date, today: string): CardView {
  if (draft.status === 'needs_clarification') {
    const payload = draft.payload as ClarifyPayload
    const expired = isExpired(draft, now)
    return {
      draft_id: draft.id,
      question: expired ? null : { text: payload.question, options: payload.options.map((option) => option.label) },
      kind: draft.kind,
      status: draft.status,
      version: draft.version,
      ...clarifyBody(draft),
      can_confirm: false,
      can_cancel: !expired,
      status_text: expired ? '已过期，请重新说一遍。' : null,
    }
  }

  const body = draft.kind === 'workout'
    ? workoutCard(draft, today)
    : draft.kind === 'weight'
      ? weightCard(draft, today)
      : mealCard(draft, today)

  const expired = !['saved', 'superseded', 'cancelled', 'failed'].includes(draft.status) && isExpired(draft, now)
  const confirmable = !expired && (draft.status === 'proposed' || draft.status === 'outcome_unknown')
  // Not while the outcome is unknown: it may already be saved, so the only safe move is to re-check.
  const cancellable = !expired && draft.status === 'proposed'

  return {
    draft_id: draft.id,
    question: null,
    kind: draft.kind,
    status: draft.status,
    version: draft.version,
    ...body,
    can_confirm: confirmable,
    can_cancel: cancellable,
    status_text: expired ? '已过期，请重新说一遍。' : (STATUS_TEXT[draft.status] ?? null),
  }
}
