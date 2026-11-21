import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AIFailReason, GenerationRecord } from '../ai/generation-log'
import { getPhotosByIds, photoDataUrl, type PhotoRow } from '../photos/store'
import { dateKeyInTimeZone } from '../utils'
import { buildCard } from './cards'
import { inferMealSlot, localHour, validTimeZone } from './dates'
import { buildMealPayload, resolveItems, type FoodEstimator } from './meal'
import { MAX_PHOTOS_PER_MEAL, PHOTO_PROMPT_VERSION, type PhotoRecognizer } from './photo-recognize'
import { proposeMealText, TEXT } from './replies'
import type { PlanItem } from './schemas'
import {
  attachDraftsToMessage,
  conversationBelongsTo,
  findReplyTo,
  getDrafts,
  insertAssistantMessage,
  insertDraft,
  insertUserMessage,
  type MessageRow,
} from './store'
import type { CardView } from './types'

/**
 * 「识别这一餐」: the ONLY path that sends a user's photo to a model.
 *
 *  - Only photos in the 饮食 album, sent in this conversation, that the user
 *    tapped "识别" on. Body-record and other photos are refused here.
 *  - The model names foods and guesses visible grams; nutrition comes from our
 *    food data (resolveItems), weights are marked as estimates.
 *  - The result is a meal DRAFT card like any typed meal. Nothing is saved
 *    until the user confirms it (lib/coach-chat/commit.ts).
 */

export class PhotoMealError extends Error {
  constructor(readonly code: 'invalid_time_zone' | 'conversation_not_found' | 'bad_photos' | 'in_progress', message: string) {
    super(message)
  }
}

export interface PhotoMealDeps {
  supabase: SupabaseClient
  userId: string
  recognizer: PhotoRecognizer
  estimator: FoodEstimator
  log?: (record: GenerationRecord) => Promise<unknown>
  now?: () => Date
  mealsEnabled?: boolean
  /** Reads a stored photo for the model. Injected so tests need no Storage. */
  readPhoto?: (supabase: SupabaseClient, row: PhotoRow) => Promise<string>
}

export interface PhotoMealInput {
  conversationId: string
  clientMessageId: string
  photoIds: string[]
  timeZone: string
}

export interface PhotoMealResult {
  duplicate: boolean
  userMessage: MessageRow
  assistantMessage: MessageRow
  cards: CardView[]
}

const AI_FAIL: ReadonlySet<string> = new Set(['not_configured', 'rate_limited', 'timeout', 'upstream_error', 'invalid_response'])

export const PHOTO_TEXT = {
  notMeal: (reason: string) => `照片里我没认出是一餐${reason ? `（${reason}）` : ''}。可以换一张清楚点的，或者直接告诉我吃了什么。`,
  readFailed: '照片读取失败了，再点一次试试，或者直接告诉我吃了什么。',
  proposed: '份量是从照片估的，可能差得不少，不对就直接说，比如「米饭 150 克」。',
} as const

export function userText(count: number): string {
  return `📷 识别这一餐（${count} 张照片）`
}

export function foodsToPlanItems(foods: Array<{ name: string; grams: number | null }>): PlanItem[] {
  return foods.map((food) => ({
    name: food.name,
    amountValue: null,
    amountUnit: null,
    grams: food.grams,
    gramsBasis: food.grams === null ? 'unknown' : 'model_estimate',
    dishKind: 'single',
  }))
}

export async function handlePhotoMeal(deps: PhotoMealDeps, input: PhotoMealInput): Promise<PhotoMealResult> {
  const now = (deps.now ?? (() => new Date()))()
  const timeZone = validTimeZone(input.timeZone)
  if (!timeZone) throw new PhotoMealError('invalid_time_zone', '无法确定你所在的时区')
  const ids = [...new Set(input.photoIds)]
  if (ids.length === 0 || ids.length > MAX_PHOTOS_PER_MEAL) {
    throw new PhotoMealError('bad_photos', `一次识别 1 到 ${MAX_PHOTOS_PER_MEAL} 张照片`)
  }
  if (!(await conversationBelongsTo(deps.supabase, deps.userId, input.conversationId))) {
    throw new PhotoMealError('conversation_not_found', '对话不存在')
  }
  const photos = await getPhotosByIds(deps.supabase, deps.userId, ids)
  const usable = photos.filter((photo) => photo.category === 'meal' && photo.conversation_id === input.conversationId)
  if (usable.length !== ids.length) {
    throw new PhotoMealError('bad_photos', '只能识别你在这段对话里发的饮食照片')
  }
  const ordered = ids.map((id) => usable.find((photo) => photo.id === id)!)

  const today = dateKeyInTimeZone(now, timeZone)
  const stored = await insertUserMessage(deps.supabase, {
    userId: deps.userId,
    conversationId: input.conversationId,
    clientMessageId: input.clientMessageId,
    text: userText(ordered.length),
    localDate: today,
  })
  if (stored.duplicate) {
    const reply = await findReplyTo(deps.supabase, deps.userId, stored.message.id)
    if (!reply) throw new PhotoMealError('in_progress', '上一次识别还在处理，请稍等一下')
    const drafts = await getDrafts(deps.supabase, deps.userId, reply.cards.map((card) => card.draft_id))
    return { duplicate: true, userMessage: stored.message, assistantMessage: reply, cards: drafts.map((d) => buildCard(d, now, today)) }
  }

  const reply = async (text: string, draftIds: string[] = []): Promise<PhotoMealResult> => {
    const assistantMessage = await insertAssistantMessage(deps.supabase, {
      userId: deps.userId,
      conversationId: input.conversationId,
      replyToMessageId: stored.message.id,
      text: text.slice(0, 3900),
      draftIds,
      localDate: today,
    })
    await attachDraftsToMessage(deps.supabase, deps.userId, draftIds, assistantMessage.id)
    const drafts = await getDrafts(deps.supabase, deps.userId, draftIds)
    return { duplicate: false, userMessage: stored.message, assistantMessage, cards: drafts.map((d) => buildCard(d, now, today)) }
  }

  if (deps.mealsEnabled === false) return reply(TEXT.featureOff)

  let images: string[]
  try {
    images = await Promise.all(ordered.map((photo) => (deps.readPhoto ?? photoDataUrl)(deps.supabase, photo)))
  } catch {
    return reply(PHOTO_TEXT.readFailed)
  }

  const recognized = await deps.recognizer(images)
  // The log never holds the image or its contents beyond counts.
  const baseRecord = {
    userId: deps.userId,
    surface: 'coach_chat' as const,
    scopeId: input.conversationId,
    inputSnapshotId: createHash('sha256').update(ordered.map((p) => p.id).join(',')).digest('hex').slice(0, 32),
    promptVersion: PHOTO_PROMPT_VERSION,
    latencyMs: recognized.latencyMs,
    trace: { traceId: stored.message.id, invokedBy: 'orchestrator' as const },
  }
  if (!recognized.ok) {
    await deps.log?.({
      ...baseRecord,
      model: recognized.model,
      payload: { photos: images.length },
      status: 'failed',
      failReason: (AI_FAIL.has(recognized.reason) ? recognized.reason : 'upstream_error') as AIFailReason,
    })
    return reply(recognized.reason === 'rate_limited' ? TEXT.aiBusy : TEXT.aiUnavailable)
  }

  const { result } = recognized
  await deps.log?.({
    ...baseRecord,
    model: recognized.model,
    payload: { photos: images.length },
    output: { is_meal: result.is_meal, foods: result.foods.length, with_grams: result.foods.filter((f) => f.grams !== null).length },
    status: 'ok',
    tokensIn: recognized.tokensIn,
    tokensOut: recognized.tokensOut,
  })
  if (!result.is_meal || result.foods.length === 0) return reply(PHOTO_TEXT.notMeal(result.reason.trim()))

  const resolved = await resolveItems(deps.supabase, deps.userId, foodsToPlanItems(result.foods), deps.estimator)
  const payload = buildMealPayload({
    date: today,
    dateSource: 'default',
    mealType: inferMealSlot(localHour(now, timeZone)),
    mealTypeSource: 'inferred',
    rawText: `照片识别：${result.foods.map((food) => food.name).join('、')}`,
    items: resolved.items,
    warnings: [...resolved.warnings, 'photo_estimate'],
  })
  const draft = await insertDraft(deps.supabase, {
    userId: deps.userId,
    conversationId: input.conversationId,
    messageId: null,
    kind: 'meal',
    payload,
  })
  const text = [proposeMealText(payload, false), PHOTO_TEXT.proposed, result.note.trim()].filter(Boolean).join('')
  return reply(text, [draft.id])
}
