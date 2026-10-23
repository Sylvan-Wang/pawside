import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AIFailReason, GenerationRecord } from '../ai/generation-log'
import { dateKeyInTimeZone } from '../utils'
import { buildCard } from './cards'
import {
  describeDate,
  inferMealSlot,
  isLateNightAmbiguous,
  localHour,
  resolveDateRef,
  validTimeZone,
  type DateRefKind,
  type MealSlot,
} from './dates'
import { getDayFacts } from './day-facts'
import {
  applyEdits,
  buildMealPayload,
  itemsFromPersisted,
  MEAL_LABELS,
  resolveItems,
  summarizeMeal,
  type FoodEstimator,
} from './meal'
import type { Planner } from './planner'
import { buildPlannerInput, COACH_CHAT_SYSTEM_PROMPT, weekdayOf } from './prompt'
import {
  normalizePlan,
  PLAN_PROMPT_VERSION,
  type NormalizedPlan,
  type PlanTask,
} from './schemas'
import {
  dayFactsText,
  proposeEditText,
  proposeMealText,
  proposeWeightText,
  proposeWorkoutText,
  TEXT,
} from './replies'
import { findSavedMeals, loadSavedMeal, type SavedMeal } from './saved-meals'
import {
  conversationBelongsTo,
  findLastSavedMealDraft,
  findReplyTo,
  getDraft,
  getDrafts,
  insertAssistantMessage,
  insertDraft,
  insertUserMessage,
  listMessages,
  listOpenDrafts,
  transitionDraft,
  attachDraftsToMessage,
  type MessageRow,
  describeError,
} from './store'
import type {
  CardView,
  ClarifyPayload,
  DraftKind,
  DraftRow,
  MealDraftItem,
  MealDraftPayload,
  WeightDraftPayload,
  WorkoutDraftPayload,
} from './types'
import { pickRecipes, recipeText } from './recipes'
import { buildWeightPayload } from './weight'
import { buildWorkoutPayload } from './workout'

/**
 * One chat turn (Patch §4): understand -> propose -> (user taps) -> commit.
 *
 * This file is the only thing that decides what a turn does, and it can only
 * create DRAFTS. Nothing here writes a meal, workout or weight; that happens in
 * commit.ts when the user confirms a card. So a wrong or manipulated plan can
 * waste a card, never change a record.
 */

export const MAX_MESSAGE_CHARS = 2000
export const MAX_TOOL_CALLS = 6
const CONTEXT_MESSAGES = 6
const LAST_MEAL_WINDOW_MS = 24 * 60 * 60 * 1000
// A repeated send of a message that has no answer yet: how long the first attempt is presumed alive, and how long to wait for it.
const IN_FLIGHT_WINDOW_MS = 60_000
const IN_FLIGHT_WAIT_MS = 10_000
const IN_FLIGHT_POLL_MS = 400

export class TurnError extends Error {
  constructor(readonly code: 'invalid_time_zone' | 'text_too_long' | 'conversation_not_found' | 'empty_text' | 'bad_answer' | 'in_progress', message: string) {
    super(message)
  }
}

export interface TurnDeps {
  supabase: SupabaseClient
  userId: string
  planner: Planner
  estimator: FoodEstimator
  /** Records the model call (never the user's text). Failures must not break the turn. */
  log?: (record: GenerationRecord) => Promise<unknown>
  now?: () => Date
  /** Switches for parts of the chat; a part that is off answers politely and writes nothing. */
  features?: { meals?: boolean; workouts?: boolean; weight?: boolean }
}

export interface TurnInput {
  conversationId: string
  clientMessageId: string
  text: string
  timeZone: string
  /** A tapped option on a question the server asked. */
  answer?: { draftId: string; optionIndex: number } | null
}

export interface TurnResult {
  duplicate: boolean
  userMessage: MessageRow
  assistantMessage: MessageRow
  cards: CardView[]
  /**
   * Cards from EARLIER messages that this turn changed (replaced by a correction,
   * cancelled, a question that got answered). The app swaps them in so no old card
   * keeps offering a button that no longer applies.
   */
  updatedCards: CardView[]
}

interface Ctx {
  deps: TurnDeps
  userId: string
  conversationId: string
  timeZone: string
  now: Date
  today: string
  hour: number
  rawText: string
  openDrafts: DraftRow[]
  calls: number
  clarificationsUsed: number
  asked: boolean
  /** Drafts this turn changed without creating a new card for them. */
  touched: Set<string>
  profileUnit: 'kg' | 'lb' | null
}

interface TaskResult {
  drafts: DraftRow[]
  texts: string[]
}

const none = (...texts: string[]): TaskResult => ({ drafts: [], texts })

function dateFailureText(reason: 'invalid_date' | 'future_date' | 'too_old'): string {
  return reason === 'future_date' ? TEXT.dateFuture : reason === 'too_old' ? TEXT.dateTooOld : TEXT.dateInvalid
}

function canAsk(ctx: Ctx): boolean {
  return ctx.clarificationsUsed < 1 && !ctx.asked
}

function summarizeDraft(draft: DraftRow): string {
  if (draft.status === 'needs_clarification') {
    const payload = draft.payload as ClarifyPayload
    return `等待回答：${payload.question}`
  }
  if (draft.kind === 'workout') {
    const payload = draft.payload as WorkoutDraftPayload
    return `运动 ${payload.workout_type} ${payload.minutes} 分钟`
  }
  if (draft.kind === 'weight') {
    const payload = draft.payload as WeightDraftPayload
    return `体重 ${payload.shown_value} ${payload.shown_unit}`
  }
  return summarizeMeal(draft.payload as MealDraftPayload)
}

async function supersede(ctx: Ctx, old: DraftRow): Promise<void> {
  ctx.touched.add(old.id)
  await transitionDraft(ctx.deps.supabase, {
    userId: ctx.userId,
    draftId: old.id,
    from: [old.status],
    to: 'superseded',
  })
}

/** Drafts this task answers: the one it points at, if it is still open and ours. */
function referencedDraft(ctx: Ctx, draftRef: string | null): DraftRow | null {
  if (!draftRef) return null
  return ctx.openDrafts.find((draft) => draft.id === draftRef) ?? null
}

async function askQuestion(ctx: Ctx, input: {
  kind: DraftKind
  about: ClarifyPayload['about']
  source: ClarifyPayload['source']
  question: string
  options: ClarifyPayload['options']
  pendingTask: PlanTask | null
  supersedes?: DraftRow | null
}): Promise<TaskResult> {
  const payload: ClarifyPayload = {
    v: 1,
    source: input.source,
    about: input.about,
    question: input.question,
    options: input.options,
    pending_task: input.pendingTask,
    raw_text: ctx.rawText.slice(0, 500),
  }
  const draft = await insertDraft(ctx.deps.supabase, {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: null,
    kind: input.kind,
    status: 'needs_clarification',
    payload,
    supersedesId: input.supersedes?.id ?? null,
    clarificationsUsed: 1,
  })
  if (input.supersedes) await supersede(ctx, input.supersedes)
  ctx.asked = true
  ctx.clarificationsUsed = 1
  return { drafts: [draft], texts: [input.question] }
}

// ---------------------------------------------------------------------------
// Task runners
// ---------------------------------------------------------------------------

type MealTask = Extract<PlanTask, { kind: 'log_meal' }>

interface MealOverrides {
  mealType?: MealSlot
  dateRef?: DateRefKind
}

async function runLogMeal(ctx: Ctx, task: MealTask, overrides: MealOverrides = {}): Promise<TaskResult> {
  const open = referencedDraft(ctx, task.draftRef)
  let base: MealTask = task
  // An answer to a question we asked: the items come from what we already understood.
  if (open?.status === 'needs_clarification') {
    const pending = (open.payload as ClarifyPayload).pending_task
    if (pending?.kind === 'log_meal') {
      base = {
        ...pending,
        mealType: task.mealType ?? pending.mealType,
        dateRef: task.dateRef !== 'unspecified' ? task.dateRef : pending.dateRef,
        explicitDate: task.dateRef !== 'unspecified' ? task.explicitDate : pending.explicitDate,
      }
    }
  }
  const dateRef = overrides.dateRef ?? base.dateRef
  const date = resolveDateRef(dateRef, base.explicitDate, ctx.timeZone, ctx.now)
  if (!date.ok) return none(dateFailureText(date.reason))

  const userMeal = overrides.mealType ?? base.mealType
  if (isLateNightAmbiguous({ meal: userMeal, dateSource: date.source, hour: ctx.hour }) && canAsk(ctx)) {
    return askQuestion(ctx, {
      kind: 'meal',
      about: 'date',
      source: 'server',
      question: `现在是凌晨，这顿${userMeal === 'snack' ? '加餐' : '晚饭'}记在昨天还是今天？`,
      options: [
        { label: '昨天', value: 'yesterday' },
        { label: '今天', value: 'today' },
      ],
      pendingTask: { ...base, mealType: userMeal },
      supersedes: open,
    })
  }

  let mealType = userMeal
  let mealTypeSource: MealDraftPayload['meal_type_source'] = 'user'
  if (!mealType) {
    if (date.date === ctx.today) {
      mealType = inferMealSlot(ctx.hour)
      mealTypeSource = 'inferred'
    } else if (canAsk(ctx)) {
      return askQuestion(ctx, {
        kind: 'meal',
        about: 'meal_type',
        source: 'server',
        question: `${describeDate(date.date, ctx.today)}这顿是哪一餐？`,
        options: (['breakfast', 'lunch', 'dinner', 'snack'] as const).map((slot) => ({ label: MEAL_LABELS[slot], value: slot })),
        pendingTask: { ...base, dateRef, mealType: null },
        supersedes: open,
      })
    } else {
      return none(TEXT.budgetExhausted)
    }
  }

  ctx.calls += 2
  const resolved = await resolveItems(ctx.deps.supabase, ctx.userId, base.items, ctx.deps.estimator)
  const payload = buildMealPayload({
    date: date.date,
    dateSource: date.source,
    mealType,
    mealTypeSource,
    rawText: ctx.rawText,
    items: resolved.items,
    warnings: resolved.warnings,
  })

  const draft = await insertDraft(ctx.deps.supabase, {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: null,
    kind: 'meal',
    payload,
    supersedesId: open?.id ?? null,
    version: open && open.kind === 'meal' ? open.version + 1 : 1,
    clarificationsUsed: open?.clarifications_used ?? ctx.clarificationsUsed,
  })
  if (open) await supersede(ctx, open)
  return { drafts: [draft], texts: [proposeMealText(payload, Boolean(open && open.status === 'proposed'))] }
}

type EditTask = Extract<PlanTask, { kind: 'edit_meal' }>

function mealLabel(meal: SavedMeal): string {
  const names = meal.items.slice(0, 3).map((item) => item.food_name_resolved || item.food_name_raw).join('、')
  return `${MEAL_LABELS[meal.meal_type]}（${names}）`
}

async function askWhichMeal(ctx: Ctx, task: EditTask, meals: SavedMeal[], open: DraftRow | null): Promise<TaskResult> {
  if (!canAsk(ctx)) return none('找到不止一餐，我不确定要改哪一餐。请到饮食记录里选择要改的那一条。')
  return askQuestion(ctx, {
    kind: 'meal_edit',
    about: 'edit_target',
    source: 'server',
    question: '要改的是哪一餐？',
    options: meals.slice(0, 4).map((meal) => ({ label: mealLabel(meal), value: meal.id })),
    pendingTask: task,
    supersedes: open,
  })
}

async function runEditMeal(ctx: Ctx, task: EditTask, overrides: { targetFoodLogId?: string } = {}): Promise<TaskResult> {
  const supabase = ctx.deps.supabase
  const open = referencedDraft(ctx, task.draftRef)
  const hasHints = task.dateRef !== 'unspecified' || task.mealType !== null

  // 1. Which thing is being edited: an unsaved card, or a saved meal.
  let editing: DraftRow | null = null
  const openMealDrafts = ctx.openDrafts.filter((d) => d.status === 'proposed' && (d.kind === 'meal' || d.kind === 'meal_edit'))
  if (open && open.status === 'proposed' && (open.kind === 'meal' || open.kind === 'meal_edit')) editing = open
  else if (!open && !hasHints && !overrides.targetFoodLogId && openMealDrafts.length === 1) editing = openMealDrafts[0]

  let saved: SavedMeal | null = null
  if (!editing) {
    if (overrides.targetFoodLogId) {
      saved = await loadSavedMeal(supabase, ctx.userId, overrides.targetFoodLogId)
      if (!saved) return none('没找到要改的那一餐，可能已经被删掉了。')
    } else if (hasHints) {
      const date = resolveDateRef(task.dateRef, task.explicitDate, ctx.timeZone, ctx.now)
      if (!date.ok) return none(dateFailureText(date.reason))
      const meals = await findSavedMeals(supabase, ctx.userId, { date: date.date, mealType: task.mealType })
      if (meals.length === 0) return none(`${describeDate(date.date, ctx.today)}${task.mealType ? MEAL_LABELS[task.mealType] : ''}没有找到饮食记录。`)
      if (meals.length > 1) return askWhichMeal(ctx, task, meals, open)
      saved = meals[0]
    } else {
      const since = new Date(ctx.now.getTime() - LAST_MEAL_WINDOW_MS).toISOString()
      const last = await findLastSavedMealDraft(supabase, ctx.userId, ctx.conversationId, since)
      const foodLogId = (last?.result as { food_log_id?: string } | null)?.food_log_id
      if (foodLogId) saved = await loadSavedMeal(supabase, ctx.userId, foodLogId)
      if (!saved) {
        const meals = await findSavedMeals(supabase, ctx.userId, { date: ctx.today })
        if (meals.length === 0) return none('今天还没有可以修改的饮食记录。')
        if (meals.length > 1) return askWhichMeal(ctx, task, meals, open)
        saved = meals[0]
      }
    }
  }

  // 2. The items to edit.
  let items: MealDraftItem[]
  let basePayload: Pick<MealDraftPayload, 'date' | 'date_source' | 'meal_type' | 'meal_type_source' | 'raw_text'> & { notes?: string | null; before?: { summary: string } }
  if (editing) {
    const current = editing.payload as MealDraftPayload
    items = current.items.map((item) => ({ ...item }))
    basePayload = {
      date: current.date,
      date_source: current.date_source,
      meal_type: current.meal_type,
      meal_type_source: current.meal_type_source,
      raw_text: current.raw_text,
      notes: current.notes,
      before: current.before,
    }
  } else {
    const meal = saved as SavedMeal
    items = itemsFromPersisted(meal.items)
    basePayload = {
      date: meal.log_date,
      date_source: 'explicit',
      meal_type: meal.meal_type,
      meal_type_source: 'kept',
      raw_text: meal.raw_input_text ?? '',
      notes: meal.notes,
      before: { summary: summarizeMeal({ meal_type: meal.meal_type, items }) },
    }
  }

  // 3. Apply.
  ctx.calls += 2
  const outcome = await applyEdits({
    supabase,
    userId: ctx.userId,
    items,
    edits: task.edits,
    added: task.items.map((item) => ({ ...item })),
    estimator: ctx.deps.estimator,
  })
  if (outcome.applied.length === 0) return none(proposeEditText([], outcome.unmatched))

  const payload = buildMealPayload({
    date: basePayload.date,
    dateSource: basePayload.date_source,
    mealType: basePayload.meal_type,
    mealTypeSource: basePayload.meal_type_source,
    rawText: basePayload.raw_text,
    items: outcome.items,
    warnings: outcome.warnings,
    before: basePayload.before,
    notes: basePayload.notes,
  })

  const draft = await insertDraft(supabase, {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: null,
    kind: editing ? editing.kind : 'meal_edit',
    payload,
    targetRecordId: editing ? editing.target_record_id : (saved as SavedMeal).id,
    targetUpdatedAt: editing ? editing.target_updated_at : (saved as SavedMeal).updated_at,
    supersedesId: editing?.id ?? open?.id ?? null,
    version: editing ? editing.version + 1 : 1,
    clarificationsUsed: editing?.clarifications_used ?? open?.clarifications_used ?? ctx.clarificationsUsed,
  })
  if (editing) await supersede(ctx, editing)
  else if (open) await supersede(ctx, open)
  return { drafts: [draft], texts: [proposeEditText(outcome.applied, outcome.unmatched)] }
}

type WorkoutTask = Extract<PlanTask, { kind: 'log_workout' }>

async function runLogWorkout(ctx: Ctx, task: WorkoutTask): Promise<TaskResult> {
  const date = resolveDateRef(task.dateRef, task.explicitDate, ctx.timeZone, ctx.now)
  if (!date.ok) return none(dateFailureText(date.reason))
  ctx.calls += 1
  const payload = await buildWorkoutPayload({
    supabase: ctx.deps.supabase,
    userId: ctx.userId,
    task,
    date: date.date,
    dateSource: date.source,
    rawText: ctx.rawText,
  })
  const draft = await insertDraft(ctx.deps.supabase, {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: null,
    kind: 'workout',
    payload,
    clarificationsUsed: ctx.clarificationsUsed,
  })
  return { drafts: [draft], texts: [proposeWorkoutText(payload)] }
}

type WeightTask = Extract<PlanTask, { kind: 'log_weight' }>

async function runLogWeight(ctx: Ctx, task: WeightTask): Promise<TaskResult> {
  const date = resolveDateRef(task.dateRef, task.explicitDate, ctx.timeZone, ctx.now)
  if (!date.ok) return none(dateFailureText(date.reason))
  ctx.calls += 1
  const built = await buildWeightPayload({
    supabase: ctx.deps.supabase,
    userId: ctx.userId,
    value: task.value,
    unit: task.unit,
    profileUnit: ctx.profileUnit ?? 'kg',
    date: date.date,
    dateSource: date.source,
    rawText: ctx.rawText,
  })
  if (!built.ok) return none(TEXT.weightOutOfRange)
  const draft = await insertDraft(ctx.deps.supabase, {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: null,
    kind: 'weight',
    payload: built.payload,
    clarificationsUsed: ctx.clarificationsUsed,
  })
  return { drafts: [draft], texts: [proposeWeightText(built.payload)] }
}

async function runQueryDay(ctx: Ctx, task: Extract<PlanTask, { kind: 'query_day' }>): Promise<TaskResult> {
  const date = resolveDateRef(task.dateRef, task.explicitDate, ctx.timeZone, ctx.now)
  if (!date.ok) return none(dateFailureText(date.reason))
  ctx.calls += 1
  const facts = await getDayFacts(ctx.deps.supabase, ctx.userId, date.date, task.aspects)
  return none(dayFactsText(facts, ctx.today))
}

async function runCancel(ctx: Ctx, task: Extract<PlanTask, { kind: 'cancel_draft' }>): Promise<TaskResult> {
  const cancellable = ctx.openDrafts.filter((d) => d.status === 'proposed' || d.status === 'needs_clarification')
  const target = referencedDraft(ctx, task.draftRef) ?? (cancellable.length === 1 ? cancellable[0] : null)
  if (!target) {
    return none(cancellable.length === 0 ? TEXT.nothingToCancel : '现在有好几张卡片在等你，请点要取消的那张卡片上的「取消」。')
  }
  const cancelled = await transitionDraft(ctx.deps.supabase, {
    userId: ctx.userId,
    draftId: target.id,
    from: [target.status],
    to: 'cancelled',
  })
  if (!cancelled) return none('这一张刚刚已经有变化了，请看看卡片上的状态。')
  // The card that was cancelled is updated where it already is; it is not shown a second time.
  ctx.touched.add(cancelled.id)
  return { drafts: [], texts: ['好，这条不记了。'] }
}

async function runTask(ctx: Ctx, task: PlanTask, plan: NormalizedPlan): Promise<TaskResult> {
  const features = ctx.deps.features ?? {}
  if ((task.kind === 'log_meal' || task.kind === 'edit_meal') && features.meals === false) return none(TEXT.featureOff)
  if (task.kind === 'log_workout' && features.workouts === false) return none(TEXT.featureOff)
  if (task.kind === 'log_weight' && features.weight === false) return none(TEXT.featureOff)
  if (ctx.calls >= MAX_TOOL_CALLS && ['log_meal', 'edit_meal', 'log_workout', 'log_weight', 'query_day'].includes(task.kind)) {
    return none('还有一件事我先放一放，等这几条处理完你再告诉我一次。')
  }
  switch (task.kind) {
    case 'log_meal': return runLogMeal(ctx, task)
    case 'edit_meal': return runEditMeal(ctx, task)
    case 'log_workout': return runLogWorkout(ctx, task)
    case 'log_weight': return runLogWeight(ctx, task)
    case 'query_day': return runQueryDay(ctx, task)
    case 'cancel_draft': return runCancel(ctx, task)
    case 'confirm_draft': return none(TEXT.confirmByButton)
    case 'consult_food': {
      ctx.calls += 1
      const facts = await getDayFacts(ctx.deps.supabase, ctx.userId, ctx.today, ['nutrition'])
      const lines = [plan.reply ?? TEXT.consultFallback]
      if (facts.meals.length > 0) {
        lines.push(`${dayFactsText(facts, ctx.today)}\n（只算已记录的，可能不完整。）`)
      }
      const suggestions = recipeText(await pickRecipes(ctx.deps.supabase, task.topic, ctx.today))
      if (suggestions) lines.push(suggestions)
      return none(lines.join('\n'))
    }
    case 'smalltalk': return none(plan.reply ?? TEXT.smalltalk)
    case 'out_of_scope': return none(TEXT[task.boundary])
    case 'invalid': {
      if (task.reason === 'no_food_items') return none(TEXT.needsFoodWhat)
      if (task.reason === 'bad_duration' || task.reason === 'no_activity') return none(TEXT.needsWorkoutMinutes)
      if (task.reason === 'bad_weight') return none(TEXT.weightOutOfRange)
      return none(TEXT.noPlan)
    }
  }
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

const KIND_FOR_ABOUT: Record<string, DraftKind> = {
  meal: 'meal',
  workout: 'workout',
  weight: 'weight',
  meal_edit: 'meal_edit',
}

function mapPlannerFailure(reason: string): AIFailReason {
  switch (reason) {
    case 'not_configured':
    case 'rate_limited':
    case 'timeout':
    case 'upstream_error':
    case 'invalid_response':
      return reason
    default:
      return 'upstream_error'
  }
}

async function loadProfileUnit(supabase: SupabaseClient, userId: string): Promise<'kg' | 'lb' | null> {
  const { data } = await supabase.from('user_profiles').select('weight_unit').eq('id', userId).maybeSingle()
  return data?.weight_unit === 'lb' ? 'lb' : data?.weight_unit === 'kg' ? 'kg' : null
}

function toCards(drafts: DraftRow[], now: Date, today: string): CardView[] {
  return drafts.map((draft) => buildCard(draft, now, today))
}

async function finish(
  ctx: Ctx,
  userMessage: MessageRow,
  text: string,
  drafts: DraftRow[],
): Promise<TurnResult> {
  const assistantMessage = await insertAssistantMessage(ctx.deps.supabase, {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    replyToMessageId: userMessage.id,
    text: text.slice(0, 3900),
    draftIds: drafts.map((draft) => draft.id),
    localDate: ctx.today,
  })
  await attachDraftsToMessage(ctx.deps.supabase, ctx.userId, drafts.map((d) => d.id), assistantMessage.id)
  // Cards show the drafts as they are now (e.g. a draft this turn already replaced).
  const fresh = await getDrafts(ctx.deps.supabase, ctx.userId, drafts.map((d) => d.id))
  const order = new Map(drafts.map((draft, index) => [draft.id, index]))
  fresh.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  const shown = new Set(drafts.map((d) => d.id))
  const updated = await getDrafts(ctx.deps.supabase, ctx.userId, [...ctx.touched].filter((id) => !shown.has(id)))
  return {
    duplicate: false,
    userMessage,
    assistantMessage,
    cards: toCards(fresh, ctx.now, ctx.today),
    updatedCards: toCards(updated, ctx.now, ctx.today),
  }
}

/** Applies a tapped option to a question the server asked, without calling the model. */
async function runAnswer(ctx: Ctx, answer: NonNullable<TurnInput['answer']>): Promise<TaskResult | null> {
  const draft = await getDraft(ctx.deps.supabase, ctx.userId, answer.draftId)
  if (!draft || draft.conversation_id !== ctx.conversationId || draft.status !== 'needs_clarification' || new Date(draft.expires_at) <= ctx.now) {
    throw new TurnError('bad_answer', '这个问题已经过期了')
  }
  const payload = draft.payload as ClarifyPayload
  const option = payload.options[answer.optionIndex]
  if (!option || payload.source !== 'server' || !payload.pending_task) return null
  const pending = payload.pending_task
  ctx.openDrafts = [draft, ...ctx.openDrafts.filter((d) => d.id !== draft.id)]
  ctx.clarificationsUsed = 1

  if (payload.about === 'date' && pending.kind === 'log_meal') {
    const dateRef = option.value === 'yesterday' ? 'yesterday' : 'today'
    return runLogMeal(ctx, { ...pending, draftRef: draft.id }, { dateRef })
  }
  if (payload.about === 'meal_type' && pending.kind === 'log_meal') {
    const mealType = (['breakfast', 'lunch', 'dinner', 'snack'] as const).find((slot) => slot === option.value)
    if (!mealType) return null
    return runLogMeal(ctx, { ...pending, draftRef: draft.id }, { mealType })
  }
  if (payload.about === 'edit_target' && pending.kind === 'edit_meal') {
    return runEditMeal(ctx, { ...pending, draftRef: draft.id }, { targetFoodLogId: option.value })
  }
  return null
}

export async function handleChatTurn(deps: TurnDeps, input: TurnInput): Promise<TurnResult> {
  const now = (deps.now ?? (() => new Date()))()
  const timeZone = validTimeZone(input.timeZone)
  if (!timeZone) throw new TurnError('invalid_time_zone', '无法确定你所在的时区')
  const text = input.text.trim()
  if (!text) throw new TurnError('empty_text', '请输入内容')
  if (text.length > MAX_MESSAGE_CHARS) throw new TurnError('text_too_long', TEXT.tooLong)
  if (!(await conversationBelongsTo(deps.supabase, deps.userId, input.conversationId))) {
    throw new TurnError('conversation_not_found', '对话不存在')
  }

  const today = dateKeyInTimeZone(now, timeZone)
  const stored = await insertUserMessage(deps.supabase, {
    userId: deps.userId,
    conversationId: input.conversationId,
    clientMessageId: input.clientMessageId,
    text,
    localDate: today,
  })

  // The same send arriving twice returns the first answer instead of running again.
  if (stored.duplicate) {
    let reply = await findReplyTo(deps.supabase, deps.userId, stored.message.id)
    // The first attempt may still be running (a double tap, a quick retry): wait for it rather than
    // starting a second copy. If it is old and never answered, it died, so it is run now.
    const sinceFirstAttempt = Date.now() - new Date(stored.message.created_at).getTime()
    if (!reply && sinceFirstAttempt < IN_FLIGHT_WINDOW_MS) {
      for (let waited = 0; !reply && waited < IN_FLIGHT_WAIT_MS; waited += IN_FLIGHT_POLL_MS) {
        await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_POLL_MS))
        reply = await findReplyTo(deps.supabase, deps.userId, stored.message.id)
      }
      if (!reply) throw new TurnError('in_progress', '上一次发送还在处理，请稍等一下')
    }
    if (reply) {
      const cards = await getDrafts(deps.supabase, deps.userId, reply.cards.map((card) => card.draft_id))
      return { duplicate: true, userMessage: stored.message, assistantMessage: reply, cards: toCards(cards, now, today), updatedCards: [] }
    }
  }

  const openDrafts = await listOpenDrafts(deps.supabase, deps.userId, input.conversationId, now)
  const ctx: Ctx = {
    deps,
    userId: deps.userId,
    conversationId: input.conversationId,
    timeZone,
    now,
    today,
    hour: localHour(now, timeZone),
    rawText: text,
    openDrafts,
    calls: 0,
    clarificationsUsed: Math.max(0, ...openDrafts.filter((d) => d.status === 'needs_clarification').map((d) => d.clarifications_used)),
    asked: false,
    touched: new Set<string>(),
    profileUnit: await loadProfileUnit(deps.supabase, deps.userId),
  }

  // A tapped option is applied directly - no model call, no re-reading the sentence.
  if (input.answer) {
    const result = await runAnswer(ctx, input.answer)
    if (result) {
      return finish(ctx, stored.message, result.texts.join('\n'), result.drafts)
    }
  }

  const recent = (await listMessages(deps.supabase, deps.userId, input.conversationId, { limit: CONTEXT_MESSAGES + 1 }))
    .filter((message) => message.id !== stored.message.id)
    .slice(-CONTEXT_MESSAGES)

  const plannerInput = buildPlannerInput({
    today,
    weekday: weekdayOf(today),
    localHour: ctx.hour,
    timeZone,
    recentMessages: recent.map((message) => ({ role: message.role, text: message.content })),
    openDrafts: openDrafts.map((draft) => ({
      id: draft.id,
      kind: draft.kind,
      summary: summarizeDraft(draft),
      pendingQuestion: draft.status === 'needs_clarification' ? (draft.payload as ClarifyPayload).question : null,
    })),
    userMessage: text,
  })

  const planned = await deps.planner(COACH_CHAT_SYSTEM_PROMPT, plannerInput)
  const snapshot = createHash('sha256').update(plannerInput).digest('hex').slice(0, 32)
  const baseRecord = {
    userId: deps.userId,
    surface: 'coach_chat' as const,
    scopeId: input.conversationId,
    inputSnapshotId: snapshot,
    promptVersion: PLAN_PROMPT_VERSION,
    latencyMs: planned.latencyMs,
    trace: { traceId: stored.message.id, invokedBy: 'orchestrator' as const },
  }

  if (!planned.ok) {
    await deps.log?.({
      ...baseRecord,
      model: planned.model,
      payload: { open_drafts: openDrafts.length, input_chars: text.length },
      status: 'failed',
      failReason: mapPlannerFailure(planned.reason),
    })
    return finish(ctx, stored.message, TEXT.aiUnavailable, [])
  }

  const plan = normalizePlan(planned.plan)
  const results: TaskResult[] = []
  const taskKinds: string[] = []
  for (const task of plan.tasks) {
    taskKinds.push(task.kind)
    try {
      results.push(await runTask(ctx, task, plan))
    } catch (error) {
      console.error('[coach-chat] task failed', task.kind, describeError(error))
      results.push(none('这一条我这边出了点问题，没有记。你可以再说一遍，或者到页面里手动记录。'))
    }
  }

  let drafts = results.flatMap((result) => result.drafts)
  const texts = results.flatMap((result) => result.texts)

  // A question from the model, only when nothing else came out of this turn.
  if (drafts.length === 0 && plan.clarification && canAsk(ctx)) {
    const about = plan.clarification.about
    const asked = await askQuestion(ctx, {
      kind: KIND_FOR_ABOUT[about],
      about,
      source: 'model',
      question: plan.clarification.question,
      options: plan.clarification.options.map((label) => ({ label, value: label })),
      pendingTask: null,
      supersedes: ctx.openDrafts.find((d) => d.status === 'needs_clarification' && d.kind === KIND_FOR_ABOUT[about]) ?? null,
    })
    drafts = asked.drafts
    texts.length = 0
    texts.push(...asked.texts)
  } else if (drafts.length === 0 && texts.length === 0) {
    texts.push(plan.clarification && !canAsk(ctx) ? TEXT.budgetExhausted : TEXT.noPlan)
  }

  // Questions this turn's proposals have answered no longer need an answer.
  const createdKinds = new Set(drafts.filter((d) => d.status === 'proposed').map((d) => d.kind))
  for (const open of ctx.openDrafts) {
    if (open.status !== 'needs_clarification') continue
    const answered = createdKinds.has(open.kind)
      || plan.tasks.some((task) => 'draftRef' in task && task.draftRef === open.id)
    if (answered) await supersede(ctx, open)
  }

  await deps.log?.({
    ...baseRecord,
    model: planned.model,
    payload: {
      task_kinds: taskKinds,
      issues: plan.issues,
      tool_calls: ctx.calls,
      open_drafts: openDrafts.length,
      input_chars: text.length,
    },
    output: { draft_kinds: drafts.map((d) => d.kind), asked: ctx.asked },
    status: 'ok',
    tokensIn: planned.usage?.inputTokens ?? null,
    tokensOut: planned.usage?.outputTokens ?? null,
  })

  return finish(ctx, stored.message, texts.filter(Boolean).join('\n') || TEXT.noPlan, drafts)
}
